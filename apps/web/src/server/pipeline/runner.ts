import type { PipelineTask, ArtifactKind, PipelineStepKey } from "@offeros/core";
import { completeSubmitted } from "../services/fill-service";
import { appendEvent } from "../repositories/application-event-repo";
import { styleMemory, type StyleMemoryKind } from "../memory/style-memory";
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
 * multi-writer phase would add a version guard to `updatePipelineTask`).
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

/**
 * Fire style-memory distillation for an approved artifact, if its version
 * history shows at least one tweak (an `instruction`-bearing version) — a
 * plain first-shot approval carries no revision signal to learn from.
 *
 * Fire-and-forget by design: this must NEVER slow down or fail the approve
 * response. The caller invokes it as `void maybeTriggerStyleDistill(...)` —
 * that `void` is the deliberate stop point, not an oversight. The entire
 * body (including the synchronous artifact lookup and version walk below)
 * runs inside a try/catch, so a corrupt-row parse throw here can never fail
 * the caller's `advance()` — it is caught and console-logged same as an LLM
 * or repo error further down. A `style-distilled` event is appended ONLY
 * when `styleMemory.distill` reports it actually learned something, so the
 * workspace timeline reflects actual outcomes, not attempts (a disabled
 * memory or a degraded/empty LLM response resolves to `false` and appends
 * nothing). Safe as fire-and-forget because this is a local, long-running
 * Next server process — there is no serverless request lifecycle to kill the
 * pending promise once the HTTP response is sent.
 */
async function maybeTriggerStyleDistill(
  ctx: PipelineContext,
  applicationId: string,
  kind: ArtifactKind,
): Promise<void> {
  try {
    const artifact = ctx.repos.getArtifact(ctx.taskId, kind);
    if (!artifact) return;
    const instructions = artifact.versions
      .map((v) => v.instruction)
      .filter((instruction): instruction is string => !!instruction);
    if (instructions.length === 0) return;
    const firstContent = artifact.versions[0]!.content;
    const approvedContent =
      artifact.versions.find((v) => v.id === artifact.currentVersionId)?.content ?? firstContent;

    const learned = await styleMemory.distill(ctx.db, ctx.runLlm, kind as StyleMemoryKind, {
      instructions,
      firstContent,
      approvedContent,
    });
    if (learned) {
      appendEvent(ctx.db, { applicationId, kind: "style-distilled", payload: { kind } });
    }
  } catch (error) {
    console.error(`[pipeline] style distill failed for task ${ctx.taskId} (${kind}):`, error);
  }
}

/**
 * Record that the user accepted an artifact.
 *
 * Two effects, and the second is the one worth protecting: a timeline event,
 * and the style-memory distillation that turns "they approved it after asking
 * for three changes" into standing preferences. That learning path used to
 * exist only inside `advance()`, reachable only by walking the step machine —
 * so any other way of accepting a document would silently have dropped it.
 * Extracted here so every caller gets both, and neither can drift from the
 * other by being copied.
 */
export function approveArtifact(
  ctx: PipelineContext,
  applicationId: string,
  kind: ArtifactKind,
): void {
  appendEvent(ctx.db, {
    applicationId,
    kind: "artifact-approved",
    payload: { kind },
  });
  void maybeTriggerStyleDistill(ctx, applicationId, kind);
}

async function persist(ctx: PipelineContext, patch: Partial<PipelineTask>): Promise<PipelineTask> {
  const updated = await ctx.repos.updatePipelineTask(ctx.taskId, patch);
  if (!updated) throw new Error(`agent task ${ctx.taskId} not found`);
  return updated;
}

async function runBody(
  ctx: PipelineContext,
  step: PipelineStep,
  task: PipelineTask,
): Promise<void> {
  await ctx.repos.updatePipelineTask(ctx.taskId, { status: "running" });
  await step.run(ctx, { ...task, status: "running" });
}

function load(ctx: PipelineContext): PipelineTask {
  const task = ctx.repos.getPipelineTask(ctx.taskId);
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

async function failed(ctx: PipelineContext, error: unknown): Promise<PipelineTask> {
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
async function runForward(ctx: PipelineContext, start: PipelineTask): Promise<PipelineTask> {
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
export async function advance(ctx: PipelineContext): Promise<PipelineTask> {
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
    if (approvedKind) approveArtifact(ctx, task.applicationId, approvedKind);
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
): Promise<PipelineTask> {
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

/**
 * Run one generation step's body out of band for a task parked at the
 * extension boundary (fill-form / submit) — the instant lane's "tailor now
 * from the panel". The task's own step and awaiting_user status are restored
 * afterwards so the fill lane never notices; a failure rethrows (after
 * restoring) instead of marking the task failed, because the task's real
 * work — the fill — is still healthy.
 */
export async function runTargetedStep(
  ctx: PipelineContext,
  key: PipelineStepKey,
): Promise<PipelineTask> {
  const task = load(ctx);
  const parkedAt = ctx.steps[task.step]?.key;
  if (
    task.status !== "awaiting_user" ||
    (parkedAt !== TERMINAL_BOUNDARY && parkedAt !== SUBMIT_GATE)
  ) {
    const err = new Error("task is not parked at the fill or submit gate");
    err.name = "ServiceError";
    throw err;
  }
  const step = ctx.steps.find((s) => s.key === key);
  if (!step) {
    const err = new Error(`unknown pipeline step ${key}`);
    err.name = "ServiceError";
    throw err;
  }
  try {
    await runBody(ctx, step, task);
  } finally {
    await persist(ctx, { status: "awaiting_user" });
  }
  appendEvent(ctx.db, {
    applicationId: task.applicationId,
    kind: "step-completed",
    payload: { step: step.key },
  });
  return load(ctx);
}

/** Begin (or resume) running a task. Equivalent to advancing from its position. */
export async function startTask(ctx: PipelineContext): Promise<PipelineTask> {
  const task = load(ctx);
  // "task-started" means the task is genuinely starting for the first time —
  // only a freshly created task sits at "queued". A repeat call (a second
  // tab firing /start while the first is still `running`, or any later
  // resume via startTask) reads a different status here and must not log a
  // second start; `advance()` still runs (and its own guards decide whether
  // that call is a no-op).
  if (task.status === "queued") {
    appendEvent(ctx.db, { applicationId: task.applicationId, kind: "task-started" });
  }
  return advance(ctx);
}
