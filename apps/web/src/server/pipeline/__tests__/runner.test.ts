import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPELINE_STEPS, type CoverLetterRequirement } from "@offeros/core";
import { LlmError } from "@offeros/llm";
import { createDb, type Db } from "../../db/client";
import { createApplication, getApplication } from "../../repositories/application-repo";
import { createAgentTask, getAgentTask, updateAgentTask } from "../../repositories/agent-task-repo";
import { listEvents } from "../../repositories/application-event-repo";
import { upsertArtifact } from "../../repositories/artifact-repo";
import { getStyleMemory } from "../../repositories/style-memory-repo";
import { makePipelineContext } from "../context";
import { advance, choose, failureReasonFor, startTask } from "../runner";
import type { PipelineStep } from "../types";

const FILL_FORM_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "fill-form");
const SUBMIT_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "submit");
const CONFIRM_RESUME_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "confirm-resume");

let db: Db;
let dir: string;
let ran: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-runner-"));
  db = createDb(join(dir, "r.db"));
  ran = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const COVER = new Set(["generate-cover-letter", "confirm-cover-letter"]);

/** Mirrors the real steps/index.ts gate logic: generate-cover-letter is a choice
 *  gate only when the requirement is optional (required auto-generates). */
function gateFor(key: string): PipelineStep["gate"] {
  if (key === "confirm-resume" || key === "confirm-cover-letter") return "confirm";
  if (key === "generate-cover-letter")
    return (task) => (task.coverLetterRequirement === "optional" ? "choice" : undefined);
  return undefined;
}

/** Controllable placeholder steps: record runs; analyze-site sets the requirement;
 *  an optional `throwAt` key makes that step's body throw (`throwError`, if given,
 *  overrides the default generic Error — e.g. to throw a specific LlmError). */
function makeSteps(
  opts: {
    requirement?: CoverLetterRequirement;
    throwAt?: string;
    throwError?: Error;
  } = {},
): PipelineStep[] {
  return PIPELINE_STEPS.map(({ key }) => ({
    key,
    gate: gateFor(key),
    shouldRun: (_ctx, task) =>
      COVER.has(key) ? task.coverLetterRequirement !== "none" && !task.skippedCoverLetter : true,
    run: async (ctx, _task) => {
      ran.push(key);
      if (opts.throwAt === key) throw opts.throwError ?? new Error(`boom at ${key}`);
      if (key === "analyze-site" && opts.requirement) {
        await ctx.repos.updateAgentTask(ctx.taskId, { coverLetterRequirement: opts.requirement });
      }
    },
  }));
}

function seedTask(): string {
  const app = createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
  });
  return createAgentTask(db, { applicationId: app.id }).id;
}

/** Seeds a `resume` artifact parked at the confirm-resume gate, ready to
 *  approve. `withInstruction: true` gives it a 2-version history where the
 *  second version carries a tweak `instruction` — the signal the style-
 *  distill trigger looks for. */
function seedResumeAtConfirmGate(taskId: string, opts: { withInstruction: boolean }): void {
  const now = Date.now();
  const v1 = { id: "v1", content: "First draft content.", rationale: "r1", createdAt: now };
  const versions = opts.withInstruction
    ? [
        v1,
        {
          id: "v2",
          content: "Tweaked content.",
          rationale: "r2",
          createdAt: now + 1,
          instruction: "Make it punchier.",
        },
      ]
    : [v1];
  upsertArtifact(db, {
    id: "art-resume-1",
    taskId,
    kind: "resume",
    versions,
    currentVersionId: versions.at(-1)!.id,
    createdAt: now,
    updatedAt: now,
  });
  updateAgentTask(db, taskId, { step: CONFIRM_RESUME_STEP, status: "awaiting_user" });
}

describe("pipeline runner", () => {
  it("runs tailor-resume then stops at the résumé confirm gate", async () => {
    const taskId = seedTask();
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "optional" }) });
    const task = await advance(ctx);
    expect(ran).toEqual(["tailor-resume"]);
    expect(task.status).toBe("awaiting_user");
    expect(PIPELINE_STEPS[task.step]?.key).toBe("confirm-resume");
  });

  it("advancing past the résumé gate runs analyze-site and stops at the cover-letter choice gate", async () => {
    const taskId = seedTask();
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "optional" }) });
    await advance(ctx); // → résumé confirm gate
    const task = await advance(ctx); // approve résumé → run analyze → choice gate
    expect(ran).toEqual(["tailor-resume", "analyze-site"]);
    expect(task.status).toBe("awaiting_user");
    expect(PIPELINE_STEPS[task.step]?.key).toBe("generate-cover-letter");
    expect(task.coverLetterRequirement).toBe("optional");
  });

  it("skips the cover-letter steps when the requirement is none and stops at the fill-form boundary", async () => {
    const taskId = seedTask();
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "none" }) });
    await advance(ctx); // → résumé confirm gate
    const task = await advance(ctx); // approve → analyze (sets none) → skip cover steps → fill-form
    expect(ran).toEqual(["tailor-resume", "analyze-site"]);
    expect(ran).not.toContain("generate-cover-letter");
    expect(task.status).toBe("awaiting_user");
    expect(PIPELINE_STEPS[task.step]?.key).toBe("fill-form");
  });

  it("generates the cover letter after the user chooses generate, then stops at its confirm gate", async () => {
    const taskId = seedTask();
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "optional" }) });
    await advance(ctx); // résumé gate
    await advance(ctx); // → cover-letter choice gate
    const task = await choose(ctx, "generate"); // run generate → confirm-cover-letter gate
    expect(ran).toEqual(["tailor-resume", "analyze-site", "generate-cover-letter"]);
    expect(task.status).toBe("awaiting_user");
    expect(PIPELINE_STEPS[task.step]?.key).toBe("confirm-cover-letter");
  });

  it("bare advance at a choice gate is a no-op (does not auto-generate)", async () => {
    const taskId = seedTask();
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "optional" }) });
    await advance(ctx); // résumé gate
    await advance(ctx); // → choice gate
    const task = await advance(ctx); // must NOT run generate
    expect(ran).toEqual(["tailor-resume", "analyze-site"]);
    expect(task.status).toBe("awaiting_user");
    expect(PIPELINE_STEPS[task.step]?.key).toBe("generate-cover-letter");
  });

  it("choose skip bypasses the cover-letter steps to the fill-form boundary", async () => {
    const taskId = seedTask();
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "optional" }) });
    await advance(ctx); // résumé gate
    await advance(ctx); // → choice gate
    const task = await choose(ctx, "skip");
    expect(ran).toEqual(["tailor-resume", "analyze-site"]);
    expect(task.skippedCoverLetter).toBe(true);
    expect(PIPELINE_STEPS[task.step]?.key).toBe("fill-form");
  });

  it("a required cover letter auto-generates with no choice stop", async () => {
    const taskId = seedTask();
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "required" }) });
    await advance(ctx); // résumé gate
    const task = await advance(ctx); // approve résumé → analyze → auto-generate → confirm-cover-letter gate
    expect(ran).toEqual(["tailor-resume", "analyze-site", "generate-cover-letter"]);
    expect(task.status).toBe("awaiting_user");
    expect(PIPELINE_STEPS[task.step]?.key).toBe("confirm-cover-letter");
  });

  it("a throwing shouldRun marks the task failed", async () => {
    const taskId = seedTask();
    const steps = makeSteps({ requirement: "optional" });
    const analyze = steps.find((s) => s.key === "analyze-site")!;
    analyze.shouldRun = () => {
      throw new Error("shouldRun boom");
    };
    const ctx = makePipelineContext(db, taskId, { steps });
    await advance(ctx); // résumé gate
    const task = await advance(ctx); // approve → analyze shouldRun throws
    expect(task.status).toBe("failed");
  });

  it("marks the task failed when a step throws and does not advance", async () => {
    const taskId = seedTask();
    const ctx = makePipelineContext(db, taskId, {
      steps: makeSteps({ requirement: "optional", throwAt: "tailor-resume" }),
    });
    const task = await advance(ctx);
    expect(task.status).toBe("failed");
    expect(PIPELINE_STEPS[task.step]?.key).toBe("tailor-resume"); // did not advance past
  });

  it("a plain advance at the fill-form boundary is a no-op (the extension fills, not the runner)", async () => {
    const taskId = seedTask();
    updateAgentTask(db, taskId, { step: FILL_FORM_STEP, status: "awaiting_user" });
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps() });
    const task = await advance(ctx);
    expect(task.status).toBe("awaiting_user");
    expect(task.step).toBe(FILL_FORM_STEP);
    expect(ran).toEqual([]);
  });

  it("a plain advance at the submit gate marks the task done AND the application applied", async () => {
    const taskId = seedTask();
    const applicationId = getAgentTask(db, taskId)!.applicationId;
    updateAgentTask(db, taskId, { step: SUBMIT_STEP, status: "awaiting_user" });
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps() });
    const task = await advance(ctx);
    expect(task.status).toBe("done");
    expect(task.step).toBe(PIPELINE_STEPS.length);
    expect(getApplication(db, applicationId)?.status).toBe("applied");
  });

  it("advancing before the submit gate does not touch the application (guarded by the service)", async () => {
    const taskId = seedTask();
    const applicationId = getAgentTask(db, taskId)!.applicationId;
    // Sitting at fill-form: even though we call advance, no submit transition runs.
    updateAgentTask(db, taskId, { step: FILL_FORM_STEP, status: "awaiting_user" });
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps() });
    await advance(ctx);
    expect(getApplication(db, applicationId)?.status).not.toBe("applied");
  });

  it("a bare advance on a running task is a no-op (no double-run / reentrancy)", async () => {
    const taskId = seedTask();
    updateAgentTask(db, taskId, { status: "running" }); // already in-flight (e.g. a second tab)
    const before = getAgentTask(db, taskId)!;
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "optional" }) });
    const task = await advance(ctx);
    expect(ran).toEqual([]); // no step body ran
    expect(task.status).toBe("running");
    expect(task.step).toBe(before.step); // state unchanged
  });

  it("honors a pause written during a step body: the following step body never runs", async () => {
    const taskId = seedTask();
    const steps = makeSteps({ requirement: "required" });
    // analyze-site pauses the task mid-body, as the pause route would while it runs.
    const analyze = steps.find((s) => s.key === "analyze-site")!;
    const origRun = analyze.run;
    analyze.run = async (ctx, task) => {
      await origRun(ctx, task); // records "analyze-site" + sets requirement=required
      await ctx.repos.updateAgentTask(ctx.taskId, { status: "paused" });
    };
    const ctx = makePipelineContext(db, taskId, { steps });
    await advance(ctx); // → résumé confirm gate (ran: tailor-resume)
    const task = await advance(ctx); // approve → analyze runs + pauses → stop before generate
    expect(ran).toEqual(["tailor-resume", "analyze-site"]);
    expect(ran).not.toContain("generate-cover-letter"); // body N+1 never ran
    expect(task.status).toBe("paused");
    expect(PIPELINE_STEPS[task.step]?.key).toBe("generate-cover-letter"); // parked at step N+1
  });

  it("resuming a task paused at submit parks at the submit boundary instead of silently completing", async () => {
    const taskId = seedTask();
    const applicationId = getAgentTask(db, taskId)!.applicationId;
    // Task was parked at submit + awaiting_user, then paused (status overwritten,
    // as POST pause does unconditionally) without ever calling advance to complete it.
    updateAgentTask(db, taskId, { step: SUBMIT_STEP, status: "paused" });
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps() });
    const task = await advance(ctx);
    expect(task.status).toBe("awaiting_user");
    expect(task.step).toBe(SUBMIT_STEP);
    expect(ran).toEqual([]);
    expect(getApplication(db, applicationId)?.status).not.toBe("applied");
  });

  it("marks the task failed with the http copy and does not rethrow when a step throws LlmError(http)", async () => {
    const taskId = seedTask();
    const ctx = makePipelineContext(db, taskId, {
      steps: makeSteps({
        requirement: "optional",
        throwAt: "tailor-resume",
        throwError: new LlmError("http", "Anthropic API returned 500: oops"),
      }),
    });
    const task = await advance(ctx);
    expect(task.status).toBe("failed");
    expect(task.failureReason).toBe(
      "Your AI provider rejected the request — check your API key and model in Settings → AI.",
    );
  });

  it("persists the no_key reason AND still rethrows (regression on the Phase-7 behavior)", async () => {
    const taskId = seedTask();
    const noKey = new LlmError(
      "no_key",
      "No API key configured for anthropic. Add one in Settings → AI.",
    );
    const ctx = makePipelineContext(db, taskId, {
      steps: makeSteps({ requirement: "optional", throwAt: "tailor-resume", throwError: noKey }),
    });
    await expect(advance(ctx)).rejects.toBe(noKey);
    const task = getAgentTask(db, taskId)!;
    expect(task.status).toBe("failed");
    expect(task.failureReason).toBe(
      "No API key configured for anthropic. Add one in Settings → AI.",
    );
  });
});

describe("pipeline runner — application events", () => {
  it("startTask appends a task-started event", async () => {
    const taskId = seedTask();
    const applicationId = getAgentTask(db, taskId)!.applicationId;
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "optional" }) });
    await startTask(ctx);
    const events = listEvents(db, applicationId);
    expect(events.map((e) => e.kind)).toEqual(["task-started", "step-completed"]);
  });

  it("calling startTask twice yields exactly ONE task-started event (a repeat call is not a new start)", async () => {
    const taskId = seedTask();
    const applicationId = getAgentTask(db, taskId)!.applicationId;
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "optional" }) });
    await startTask(ctx); // queued → runs tailor-resume → awaiting_user at the résumé confirm gate
    await startTask(ctx); // not queued anymore — must not log a second start
    const events = listEvents(db, applicationId);
    expect(events.filter((e) => e.kind === "task-started")).toHaveLength(1);
  });

  it("a second /start while the task is still `running` (the second-tab reentrancy case) does not log a second task-started", async () => {
    const taskId = seedTask();
    const applicationId = getAgentTask(db, taskId)!.applicationId;
    updateAgentTask(db, taskId, { status: "running" }); // simulate: first /start call is already mid-flight
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "optional" }) });
    const task = await startTask(ctx); // advance()'s reentrancy guard no-ops this call
    expect(task.status).toBe("running");
    expect(ran).toEqual([]);
    const events = listEvents(db, applicationId);
    expect(events.filter((e) => e.kind === "task-started")).toHaveLength(0);
  });

  it("each successful step body run appends a step-completed event with its step key", async () => {
    const taskId = seedTask();
    const applicationId = getAgentTask(db, taskId)!.applicationId;
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "optional" }) });
    await advance(ctx); // runs tailor-resume → résumé confirm gate
    const events = listEvents(db, applicationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "step-completed", payload: { step: "tailor-resume" } });
  });

  it("approving the résumé confirm gate appends an artifact-approved event for kind resume", async () => {
    const taskId = seedTask();
    const applicationId = getAgentTask(db, taskId)!.applicationId;
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "optional" }) });
    await advance(ctx); // → résumé confirm gate
    await advance(ctx); // approve → runs analyze-site → choice gate
    const events = listEvents(db, applicationId);
    expect(events.map((e) => e.kind)).toEqual([
      "step-completed", // tailor-resume
      "artifact-approved", // résumé approved
      "step-completed", // analyze-site
    ]);
    expect(events[1]?.payload).toEqual({ kind: "resume" });
  });

  it("approving the cover-letter confirm gate appends an artifact-approved event for kind cover-letter", async () => {
    const taskId = seedTask();
    const applicationId = getAgentTask(db, taskId)!.applicationId;
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "required" }) });
    await advance(ctx); // résumé gate
    await advance(ctx); // approve résumé → analyze → auto-generate cover letter → confirm-cover-letter gate
    await advance(ctx); // approve cover letter → fill-form boundary
    const events = listEvents(db, applicationId);
    const approved = events.filter((e) => e.kind === "artifact-approved");
    expect(approved.map((e) => e.payload)).toEqual([{ kind: "resume" }, { kind: "cover-letter" }]);
  });

  it("choosing generate at the cover-letter choice gate appends a step-completed event", async () => {
    const taskId = seedTask();
    const applicationId = getAgentTask(db, taskId)!.applicationId;
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "optional" }) });
    await advance(ctx); // résumé gate
    await advance(ctx); // → choice gate
    await choose(ctx, "generate");
    const events = listEvents(db, applicationId);
    expect(events.map((e) => e.kind)).toEqual([
      "step-completed", // tailor-resume
      "artifact-approved", // résumé approved
      "step-completed", // analyze-site
      "step-completed", // generate-cover-letter
    ]);
    expect(events.at(-1)?.payload).toEqual({ step: "generate-cover-letter" });
  });

  it("choosing skip does not append a step-completed event for the skipped step", async () => {
    const taskId = seedTask();
    const applicationId = getAgentTask(db, taskId)!.applicationId;
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "optional" }) });
    await advance(ctx); // résumé gate
    await advance(ctx); // → choice gate
    await choose(ctx, "skip");
    const events = listEvents(db, applicationId);
    expect(
      events.some(
        (e) => e.kind === "step-completed" && e.payload?.step === "generate-cover-letter",
      ),
    ).toBe(false);
  });

  it("skipping a not-applicable cover-letter step (requirement none) does not append a step-completed event", async () => {
    const taskId = seedTask();
    const applicationId = getAgentTask(db, taskId)!.applicationId;
    const ctx = makePipelineContext(db, taskId, { steps: makeSteps({ requirement: "none" }) });
    await advance(ctx); // résumé gate
    await advance(ctx); // approve → analyze (sets none) → skip cover steps → fill-form
    const events = listEvents(db, applicationId);
    expect(events.map((e) => e.kind)).toEqual([
      "step-completed", // tailor-resume
      "artifact-approved", // résumé approved
      "step-completed", // analyze-site
    ]);
  });
});

describe("pipeline runner — style memory distill trigger", () => {
  it("approving a tweaked artifact fires distill asynchronously and appends a style-distilled event on success", async () => {
    const taskId = seedTask();
    const applicationId = getAgentTask(db, taskId)!.applicationId;
    seedResumeAtConfirmGate(taskId, { withInstruction: true });

    let capturedInput: unknown;
    const ctx = makePipelineContext(db, taskId, {
      steps: makeSteps({ requirement: "optional" }),
      runLlm: async (llmTaskId, input) => {
        if (llmTaskId === "style-distill") {
          capturedInput = input;
          return { notes: "- Prefers punchier phrasing." };
        }
        throw new Error(`unexpected task id ${llmTaskId}`);
      },
    });

    const task = await advance(ctx); // approve — response must return before distill settles
    expect(task.status).toBe("awaiting_user"); // approve latency/response unaffected

    await vi.waitFor(() => {
      const events = listEvents(db, applicationId);
      expect(events.some((e) => e.kind === "style-distilled")).toBe(true);
    });

    expect(capturedInput).toMatchObject({
      instructions: ["Make it punchier."],
      firstContent: "First draft content.",
      approvedContent: "Tweaked content.",
    });
    expect(getStyleMemory(db, "resume")?.notes).toBe("- Prefers punchier phrasing.");

    const events = listEvents(db, applicationId);
    const distilled = events.find((e) => e.kind === "style-distilled");
    expect(distilled?.payload).toEqual({ kind: "resume" });
  });

  it("approving an untweaked (single-version) artifact does not fire distill", async () => {
    const taskId = seedTask();
    const applicationId = getAgentTask(db, taskId)!.applicationId;
    seedResumeAtConfirmGate(taskId, { withInstruction: false });

    const ctx = makePipelineContext(db, taskId, {
      steps: makeSteps({ requirement: "optional" }),
      runLlm: async (llmTaskId) => {
        throw new Error(`style-distill must not be called: got ${llmTaskId}`);
      },
    });

    await advance(ctx);

    const events = listEvents(db, applicationId);
    expect(events.some((e) => e.kind === "style-distilled")).toBe(false);
    expect(getStyleMemory(db, "resume")).toBeNull();
  });

  it("a distill rejection is silent: the approve response is unaffected and no style-distilled event is written", async () => {
    const taskId = seedTask();
    const applicationId = getAgentTask(db, taskId)!.applicationId;
    seedResumeAtConfirmGate(taskId, { withInstruction: true });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const ctx = makePipelineContext(db, taskId, {
      steps: makeSteps({ requirement: "optional" }),
      runLlm: async (llmTaskId) => {
        if (llmTaskId === "style-distill") throw new Error("distill boom");
        throw new Error(`unexpected task id ${llmTaskId}`);
      },
    });

    const task = await advance(ctx);
    expect(task.status).toBe("awaiting_user"); // approve did not throw / was not delayed

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    const events = listEvents(db, applicationId);
    expect(events.some((e) => e.kind === "style-distilled")).toBe(false);
    expect(getStyleMemory(db, "resume")).toBeNull();

    consoleErrorSpy.mockRestore();
  });
});

describe("failureReasonFor", () => {
  it("reuses the provider message verbatim for kind no_key", () => {
    const err = new LlmError(
      "no_key",
      "No API key configured for anthropic. Add one in Settings → AI.",
    );
    expect(failureReasonFor(err)).toBe(
      "No API key configured for anthropic. Add one in Settings → AI.",
    );
  });

  it("returns the fixed copy for kind http", () => {
    const err = new LlmError("http", "Anthropic API returned 500: oops");
    expect(failureReasonFor(err)).toBe(
      "Your AI provider rejected the request — check your API key and model in Settings → AI.",
    );
  });

  it("returns the fixed copy for kind bad_output", () => {
    const err = new LlmError("bad_output", "Extracted content did not match the expected shape.");
    expect(failureReasonFor(err)).toBe(
      "The AI response couldn't be parsed — try again or switch models.",
    );
  });

  it("returns the generic fallback for a non-LlmError", () => {
    expect(failureReasonFor(new Error("boom"))).toBe(
      "Something went wrong while generating. Check the server logs for details.",
    );
  });

  it("returns the generic fallback for a non-Error thrown value", () => {
    expect(failureReasonFor("plain string throw")).toBe(
      "Something went wrong while generating. Check the server logs for details.",
    );
  });
});
