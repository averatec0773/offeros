import type { AgentTask, ArtifactKind, PipelineStepKey } from "@offeros/core";
import { completeSubmitted } from "../services/fill-service";
import { appendEvent } from "../repositories/application-event-repo";
import { resolveGate, type PipelineContext, type PipelineStep } from "./types";

/**
 * The pipeline state machine.
 *
 * A **confirm gate** (confirm-resume, confirm-cover-letter) is a pure
 * post-artifact stop: the artifact was produced by the preceding step, so
 * approving via `advance` just moves on — no body runs.
 *
 * A **choice gate** (an *optional* cover letter) is a pre-artifact decision:
 * `advance` alone will NOT run it — the caller must call `choose(ctx, "skip" |
 * "generate")`. "generate" runs the body; "skip" sets `skippedCoverLetter` so
 * `shouldRun` becomes false and the step (and its confirm) are skipped. A
 * *required* cover letter has no choice gate and auto-generates; `none` is
 * skipped by `shouldRun`.
 *
 * `fill-form` is the terminal boundary: the runner stops there with
 * `awaiting_user` and never executes it (filling belongs to the extension in
 * 2c) — a plain `advance` at fill-form is a no-op. The extension drives the
 * task off fill-form via the fill service (`applyFillReport`/`resolveFill`).
 * `submit` is the final gate: a plain `advance` there is the terminal
 * "mark submitted", routed through the service so the task is marked done and
 * the application applied together (never a silent fall-through to `done`).
 * `runForward` treats both as stop boundaries — it parks at either with
 * `awaiting_user` and never runs their (no-op) bodies — so a task resumed
 * from any non-`awaiting_user` status (e.g. `paused`) can never fall through
 * `submit` into `done` without the explicit completion path above.
 *
 * Concurrency: this targets a single-process local server; `advance`/`choose`
 * are expected to run serially per task. There is no optimistic lock, so
 * genuinely concurrent calls for the same task are out of scope (a future
 * multi-writer phase would add a version guard to `updateAgentTask`).
 */

const TERMINAL_BOUNDARY = "fill-form";
const SUBMIT_GATE = "submit";
/** Steps `runForward` never runs through — it parks at them with `awaiting_user`. */
const RUN_FORWARD_BOUNDARIES = new Set<string>([TERMINAL_BOUNDARY, SUBMIT_GATE]);
/** Which artifact kind a confirm-gate step key approves — the only two confirm
 *  gates in the registry (see steps/index.ts's GATES). */
const CONFIRM_ARTIFACT_KIND: Partial<Record<PipelineStepKey, ArtifactKind>> = {
  "confirm-resume": "resume",
  "confirm-cover-letter": "cover-letter",
};

async function persist(ctx: PipelineContext, patch: Partial<AgentTask>): Promise<AgentTask> {
  const updated = await ctx.repos.updateAgentTask(ctx.taskId, patch);
  if (!updated) throw new Error(`agent task ${ctx.taskId} not found`);
  return updated;
}

async function runBody(ctx: PipelineContext, step: PipelineStep, task: AgentTask): Promise<void> {
  await ctx.repos.updateAgentTask(ctx.taskId, { status: "running" });
  await step.run(ctx, { ...task, status: "running" });
}

function load(ctx: PipelineContext): AgentTask {
  const task = ctx.repos.getAgentTask(ctx.taskId);
  if (!task) throw new Error(`agent task ${ctx.taskId} not found`);
  return task;
}

/** User-readable copy for a failed task, shown in the workspace timeline.
 *  Structural `LlmError` detection (matches the `no_key` check below) to avoid
 *  a server -> packages/llm import cycle. */
export function failureReasonFor(error: unknown): string {
  if (error instanceof Error && error.name === "LlmError") {
    const kind = (error as { kind?: string }).kind;
    if (kind === "no_key") return error.message;
    if (kind === "http") {
      return "Your AI provider rejected the request — check your API key and model in Settings → AI.";
    }
    if (kind === "bad_output") {
      return "The AI response couldn't be parsed — try again or switch models.";
    }
  }
  return "Something went wrong while generating. Check the server logs for details.";
}

async function failed(ctx: PipelineContext, error: unknown): Promise<AgentTask> {
  console.error(`[pipeline] task ${ctx.taskId} failed:`, error);
  const task = await persist(ctx, { status: "failed", failureReason: failureReasonFor(error) });
  // A missing provider key is a user-fixable configuration error, not a task
  // outcome — rethrow it (after persisting `failed`) so it reaches the route's
  // `handle()` and maps to the 42000 envelope, instead of being swallowed here
  // as a generic pipeline failure the workspace banner can never see.
  if (
    error instanceof Error &&
    error.name === "LlmError" &&
    (error as { kind?: string }).kind === "no_key"
  ) {
    throw error;
  }
  return task;
}

/**
 * Run forward from the task's current step until the next gate, the 2b terminal
 * boundary, or the end. Assumes the task is not currently paused at a gate the
 * user must act on.
 */
async function runForward(ctx: PipelineContext, start: AgentTask): Promise<AgentTask> {
  let task = start;
  let ranBody = false;
  for (;;) {
    // Honor a pause written mid-run: once a body has finished (and its step+1 was
    // persisted), re-read fresh state before starting the next step. If a pause
    // landed while that body ran, stop here — the next body must not run. The
    // first iteration is exempt so resuming a paused task can move forward.
    if (ranBody) {
      task = load(ctx);
      if (task.status === "paused") return task;
    }
    const step = ctx.steps[task.step];
    if (!step) return persist(ctx, { status: "done" });
    if (RUN_FORWARD_BOUNDARIES.has(step.key)) return persist(ctx, { status: "awaiting_user" });

    let should: boolean;
    try {
      should = await step.shouldRun(ctx, task);
    } catch (error) {
      return failed(ctx, error);
    }
    if (!should) {
      task = await persist(ctx, { step: task.step + 1 });
      continue;
    }
    if (resolveGate(step, task)) return persist(ctx, { status: "awaiting_user" });

    try {
      await runBody(ctx, step, task);
    } catch (error) {
      return failed(ctx, error);
    }
    task = await persist(ctx, { step: task.step + 1 });
    appendEvent(ctx.db, {
      applicationId: task.applicationId,
      kind: "step-completed",
      payload: { step: step.key },
    });
    ranBody = true;
  }
}

/**
 * Approve the current confirm gate (if any) and run forward to the next stop.
 * At a **choice** gate this is a no-op that re-reports `awaiting_user` — the
 * caller must use `choose()` there. Also used to (re)start a queued/paused task.
 */
export async function advance(ctx: PipelineContext): Promise<AgentTask> {
  const task = load(ctx);
  if (task.status === "done" || task.status === "failed") return task;
  // Reentrancy guard: a task already `running` is mid-pipeline (e.g. a second
  // tab firing advance/start). Re-entering would double-run the pipeline —
  // duplicate LLM calls, artifact versions, step races. Return it unchanged.
  // If a killed process ever strands a task at `running`, the escape hatch is
  // pause (allowed from `running`) → advance, which re-enters via `paused`.
  if (task.status === "running") return task;

  if (task.status === "awaiting_user") {
    const step = ctx.steps[task.step];
    if (!step || step.key === TERMINAL_BOUNDARY) return task; // fill-form: the extension fills, never plain-advanced
    // Submit gate: the ONLY forward transition is the terminal "mark submitted".
    // A plain advance here must go through the service so the task is marked
    // done AND the application applied — never a silent fall-through to `done`.
    if (step.key === SUBMIT_GATE) return completeSubmitted(ctx.db, ctx.taskId);
    const gate = resolveGate(step, task);
    if (gate === "choice") return task; // a decision is required — use choose()
    // confirm gate: pure stop, move past without running a body. This is the
    // one site that actually knows an approval happened (vs. a generic
    // advance) — the confirm-resume/confirm-cover-letter step key it's
    // parked at names the artifact kind being approved.
    const approvedKind = CONFIRM_ARTIFACT_KIND[step.key];
    if (approvedKind) {
      appendEvent(ctx.db, {
        applicationId: task.applicationId,
        kind: "artifact-approved",
        payload: { kind: approvedKind },
      });
    }
    return runForward(ctx, await persist(ctx, { step: task.step + 1 }));
  }

  return runForward(ctx, task);
}

/**
 * Act on a choice gate (an optional cover letter). "skip" marks it skipped so
 * the generate + confirm steps are skipped; "generate" runs the generation body.
 * Then runs forward to the next stop.
 */
export async function choose(
  ctx: PipelineContext,
  choice: "skip" | "generate",
): Promise<AgentTask> {
  let task = load(ctx);
  if (task.status !== "awaiting_user") return task;
  const step = ctx.steps[task.step];
  if (!step || resolveGate(step, task) !== "choice") return task; // not at a choice gate

  if (choice === "skip") {
    task = await persist(ctx, { skippedCoverLetter: true });
    return runForward(ctx, await persist(ctx, { step: task.step + 1 }));
  }

  // generate
  let ran = false;
  try {
    if (await step.shouldRun(ctx, task)) {
      await runBody(ctx, step, task);
      ran = true;
    }
  } catch (error) {
    return failed(ctx, error);
  }
  const next = await persist(ctx, { step: task.step + 1 });
  if (ran) {
    appendEvent(ctx.db, {
      applicationId: next.applicationId,
      kind: "step-completed",
      payload: { step: step.key },
    });
  }
  return runForward(ctx, next);
}

/** Begin (or resume) running a task. Equivalent to advancing from its position. */
export async function startTask(ctx: PipelineContext): Promise<AgentTask> {
  const task = load(ctx);
  appendEvent(ctx.db, { applicationId: task.applicationId, kind: "task-started" });
  return advance(ctx);
}
