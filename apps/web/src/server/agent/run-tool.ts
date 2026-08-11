import { appendTrace } from "../repositories/agent-trace-repo";
import { getPipelineTask } from "../repositories/pipeline-task-repo";
import type { Tool, ToolContext, ToolObservation } from "./types";

/**
 * The only way a tool runs.
 *
 * `runTool` is where the contract in ./types.ts is actually enforced, so that
 * no capability can be honest "by convention":
 *
 *   - input parse failures become a `precondition` failure, never a throw that
 *     a caller might swallow,
 *   - an unexpected throw becomes a `dependency` failure with its message —
 *     the agent keeps its footing when a provider or the filesystem does not,
 *   - a tool that claims success but whose `verify` disagrees is DOWNGRADED to
 *     failure. A tool cannot talk its way past its own verification,
 *   - every outcome, verified or not, lands on the trace.
 *
 * Callers get an observation, never an exception.
 */
export async function runTool<I, R>(
  tool: Tool<I, R>,
  ctx: ToolContext,
  rawInput: unknown,
): Promise<ToolObservation<R>> {
  const startedAt = Date.now();

  // The ledger has to follow the work. A context whose applicationId does not
  // own its taskId would act on one application and file the record under
  // another — the irreversible tools (mark_submitted) turn that into "closed
  // over there, no record here". Refuse rather than reconcile.
  if (ctx.taskId) {
    const task = getPipelineTask(ctx.db, ctx.taskId);
    if (task && task.applicationId !== ctx.applicationId) {
      return {
        ok: false,
        summary: `${tool.id}: task belongs to a different application`,
        failure: {
          kind: "precondition",
          reason: `task ${ctx.taskId} belongs to application ${task.applicationId}`,
        },
      };
    }
  }

  const record = (obs: ToolObservation<R>, verified?: boolean) => {
    appendTrace(ctx.db, {
      applicationId: ctx.applicationId,
      taskId: ctx.taskId,
      tool: tool.id,
      reason: ctx.reason,
      ok: obs.ok,
      // A missing summary must not cost the row: the NOT NULL column would
      // reject it, appendTrace would swallow the error, and a call that really
      // happened would leave no trace.
      summary: obs.summary || tool.id,
      failureKind: obs.failure?.kind,
      failureReason: obs.failure?.reason,
      verified,
      durationMs: Date.now() - startedAt,
    });
    return obs;
  };

  let input: I;
  try {
    input = tool.parse ? tool.parse(rawInput) : (rawInput as I);
  } catch (error) {
    return record({
      ok: false,
      summary: `${tool.id}: invalid input`,
      failure: { kind: "precondition", reason: messageOf(error) },
    });
  }

  let observation: ToolObservation<R>;
  try {
    observation = await tool.run(ctx, input);
  } catch (error) {
    // A service precondition failure ("task is not at the submit gate") is a
    // state that will never become ready on its own — telling a repair ladder
    // it is a dependency outage invites an infinite retry.
    const isStateRefusal = error instanceof Error && error.name === "ServiceError";
    return record({
      ok: false,
      summary: `${tool.id} failed`,
      failure: {
        kind: isStateRefusal ? "precondition" : "dependency",
        reason: messageOf(error),
      },
    });
  }

  if (!observation.ok || !tool.verify) return record(observation);

  // Verification runs against the durable world, not against `run`'s own
  // report — that difference is the whole point.
  let verified: boolean | null;
  try {
    verified = await tool.verify(ctx, input, observation.result);
  } catch (error) {
    return record(
      {
        ok: false,
        summary: `${tool.id}: could not verify`,
        failure: { kind: "unverified", reason: messageOf(error) },
      },
      false,
    );
  }

  if (verified === false) {
    // Deliberately NOT "nothing happened": the tool ran, and whatever it did
    // is still out there. `result` is kept so a caller can reach a partial
    // effect instead of being told the world is untouched.
    return record(
      {
        ok: false,
        summary: `${tool.id}: could not confirm the change landed`,
        result: observation.result,
        failure: {
          kind: "unverified",
          reason: "the effect could not be confirmed — it may be partially applied",
        },
      },
      false,
    );
  }
  // null = nothing external to check; true = confirmed.
  return record(observation, verified ?? undefined);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
