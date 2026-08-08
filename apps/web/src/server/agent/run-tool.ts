import { appendTrace } from "../repositories/agent-trace-repo";
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

  const record = (obs: ToolObservation<R>, verified?: boolean) => {
    appendTrace(ctx.db, {
      applicationId: ctx.applicationId,
      taskId: ctx.taskId,
      tool: tool.id,
      reason: ctx.reason,
      ok: obs.ok,
      summary: obs.summary,
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
    return record({
      ok: false,
      summary: `${tool.id} failed`,
      failure: { kind: "dependency", reason: messageOf(error) },
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
    return record(
      {
        ok: false,
        summary: `${tool.id}: reported success but the change is not there`,
        failure: { kind: "unverified", reason: "verification found no effect" },
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
