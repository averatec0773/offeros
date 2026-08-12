/**
 * Adversarial audit of the tool contract (`run-tool.ts` + `tools.ts`).
 * Every case here FAILS today and states the behaviour the contract claims.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPELINE_STEPS } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import { createApplication, getApplication } from "../../repositories/application-repo";
import {
  createPipelineTask,
  updatePipelineTask,
  getPipelineTask,
  listPipelineTasks,
} from "../../repositories/pipeline-task-repo";
import { upsertArtifact, getArtifact } from "../../repositories/artifact-repo";
import { listTrace } from "../../repositories/agent-trace-repo";
import { listAnswers } from "../../repositories/answer-repo";
import { runTool } from "../run-tool";
import type { Tool, ToolContext } from "../types";

const runTargetedStep = vi.fn(async () => undefined);
vi.mock("../../pipeline/runner", () => ({
  runTargetedStep: (...a: unknown[]) => runTargetedStep(...(a as [])),
  startTask: vi.fn(),
  advance: vi.fn(),
  choose: vi.fn(),
}));
const runLlm = vi.fn(async () => ({ answer: "drafted answer text" }));
vi.mock("../../pipeline/route-context", () => ({
  buildPipelineContext: () => ({ runLlm: (...a: unknown[]) => runLlm(...(a as [])) }),
}));

const tweakArtifact = vi.fn(async () => undefined);
vi.mock("../../pipeline/tweak", () => ({
  tweakArtifact: (...a: unknown[]) => tweakArtifact(...(a as [])),
}));

const {
  markSubmittedTool,
  tailorResumeTool,
  coverLetterTool,
  refineArtifactTool,
  draftAnswerTool,
  openFillTool,
  checkGateTool,
} = await import("../tools");

const FILL = PIPELINE_STEPS.findIndex((s) => s.key === "fill-form");
const SUBMIT = PIPELINE_STEPS.findIndex((s) => s.key === "submit");

let db: Db;
let dir: string;
let appId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-audit-contract-"));
  db = createDb(join(dir, "t.db"));
  appId = createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "AI Engineer", companyName: "Acme" },
  }).id;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("a verify-false downgrade must not read as a no-op", () => {
  it("says the effect could not be confirmed, and keeps what the tool reported", async () => {
    // A generic rollback is not available here: tools await network work (LLM
    // calls), and better-sqlite3 transactions are synchronous — holding one
    // across an await is not something this process can honestly promise. So
    // the contract is honesty instead of atomicity: the mutation may well have
    // landed, and the observation must not claim otherwise.
    const mutating: Tool<void, { n: number }> = {
      id: "mutate",
      description: "writes a durable row, then fails its own verify",
      run: async (c) => {
        createPipelineTask(c.db, { applicationId: c.applicationId });
        return { ok: true, summary: "created a task", result: { n: 1 } };
      },
      verify: async () => false,
    };

    const obs = await runTool(mutating, { db, applicationId: appId, reason: "audit" }, undefined);

    expect(obs.ok).toBe(false);
    expect(obs.failure?.kind).toBe("unverified");
    // Not "nothing happened": the wording and the reason both admit the write
    // may be out there.
    expect(obs.summary).toContain("could not confirm");
    expect(obs.failure?.reason).toContain("partially applied");
    // And the caller can still reach whatever the tool did produce.
    expect(obs.result).toEqual({ n: 1 });
    // The row really is still there — which is exactly why the message above
    // must not say otherwise.
    expect(listPipelineTasks(db)).toHaveLength(1);
  });
});

describe("a tool's ledger entry must follow the task it actually touched", () => {
  it("cannot mark one application submitted and file the trace under another", async () => {
    const other = createApplication(db, {
      jobInfo: { jobId: "j2", jobTitle: "Other", companyName: "Beta" },
    }).id;
    const task = createPipelineTask(db, { applicationId: appId });
    updatePipelineTask(db, task.id, { step: SUBMIT, status: "awaiting_user" });

    // ctx.applicationId and ctx.taskId disagree; nothing in the contract binds them.
    const ctx: ToolContext = { db, applicationId: other, taskId: task.id, reason: "audit" };
    await runTool(markSubmittedTool, ctx, { confirmedByUser: true });

    // Today: appId is flipped to "applied", its task is "done", the trace row
    // lands on `other` saying "reported success but the change is not there",
    // and listTrace(appId) is empty. An irreversible action with no ledger.
    expect(getApplication(db, appId)?.status).not.toBe("applied");
    expect(getPipelineTask(db, task.id)?.status).not.toBe("done");
    expect(listTrace(db, other)).toEqual([]);
  });
});

describe("tailor_resume's verify must be independent of run's own check", () => {
  it("does not report a verified success when the step produced nothing new", async () => {
    const task = createPipelineTask(db, { applicationId: appId });
    const now = Date.now();
    upsertArtifact(db, {
      id: "art-1",
      taskId: task.id,
      kind: "resume",
      versions: [{ id: "v1", content: "yesterday's résumé", rationale: "", createdAt: now }],
      currentVersionId: "v1",
      createdAt: now,
      updatedAt: now,
    });
    // The step does nothing at all.
    const ctx: ToolContext = { db, applicationId: appId, taskId: task.id, reason: "audit" };
    const obs = await runTool(tailorResumeTool, ctx, undefined);

    // Today: ok:true, "tailored résumé (1 version)", verified:true — off an
    // artifact that predates the call. `verify` is run's own check, verbatim.
    expect(obs.ok).toBe(false);
    expect(listTrace(db, appId)[0]?.verified).not.toBe(true);
  });
});

describe("a task-scoped tool without a task refuses as a precondition, with a way out", () => {
  /**
   * These tools used to `throw new Error("this tool needs a task")`, which
   * arrives at the agent as a `dependency` failure — the class that means "an
   * outage, try again" — carrying no remedy. A real turn burned three of its six
   * steps on exactly that, retrying tools that could not work until the
   * conversation named an application.
   */
  const anyTool = (t: unknown) => t as Tool<never, unknown>;
  const cases: { id: string; tool: Tool<never, unknown>; input?: unknown }[] = [
    { id: "tailor_resume", tool: anyTool(tailorResumeTool) },
    { id: "generate_cover_letter", tool: anyTool(coverLetterTool) },
    {
      id: "refine_artifact",
      tool: anyTool(refineArtifactTool),
      input: { kind: "resume", instruction: "make it shorter" },
    },
    {
      id: "draft_answer",
      tool: anyTool(draftAnswerTool),
      input: { question: "Why do you want to work here?" },
    },
    { id: "open_fill", tool: anyTool(openFillTool) },
    { id: "mark_submitted", tool: anyTool(markSubmittedTool), input: { confirmedByUser: true } },
    { id: "check_gate", tool: anyTool(checkGateTool) },
  ];

  for (const { id, tool, input } of cases) {
    it(`${id} states the class and how to recover`, async () => {
      // No taskId in the context — the global conversation before it has
      // settled on a job.
      const ctx: ToolContext = { db, applicationId: appId, reason: "audit" };
      const obs = await runTool(tool, ctx, input);

      expect(obs.ok).toBe(false);
      expect(obs.failure?.kind).toBe("precondition");
      // The remedy is IN the observation: what to call, and what to stop doing.
      expect(obs.failure?.reason).toContain("list_applications");
      expect(obs.failure?.reason).toContain("applicationId");
      expect(obs.failure?.reason).toMatch(/not call this tool again|ask the user/);
      // Not the old shape: no bare throw dressed up as an outage.
      expect(obs.failure?.reason).not.toBe("this tool needs a task");
      // And the refusal is on the ledger like every other outcome.
      expect(listTrace(db, appId).at(-1)).toMatchObject({
        tool: id,
        ok: false,
        failureKind: "precondition",
      });
    });
  }

  it("does nothing on the way out — a refusal is not a half-done write", async () => {
    runTargetedStep.mockClear();
    tweakArtifact.mockClear();
    const ctx: ToolContext = { db, applicationId: appId, reason: "audit" };
    await runTool(tailorResumeTool, ctx, undefined);
    await runTool(refineArtifactTool, ctx, { kind: "resume", instruction: "shorter" });
    expect(runTargetedStep).not.toHaveBeenCalled();
    expect(tweakArtifact).not.toHaveBeenCalled();
  });
});

describe("a wrong-state refusal is not a dependency outage", () => {
  it("classifies mark_submitted outside the submit gate as precondition/human-gate", async () => {
    const task = createPipelineTask(db, { applicationId: appId });
    updatePipelineTask(db, task.id, { step: FILL, status: "awaiting_user" });
    const ctx: ToolContext = { db, applicationId: appId, taskId: task.id, reason: "audit" };
    const obs = await runTool(markSubmittedTool, ctx, { confirmedByUser: true });
    expect(obs.ok).toBe(false);
    // "dependency" tells a repair ladder to retry an external outage; the real
    // answer is that the task is in the wrong state and never will be ready.
    expect(obs.failure?.kind).not.toBe("dependency");
  });
});

describe("'every tool call is traced'", () => {
  it("still writes a row when a tool omits its summary", async () => {
    const quiet: Tool<void, unknown> = {
      id: "quiet",
      description: "returns a success with no summary",
      run: async () => ({ ok: true, summary: undefined as unknown as string }),
    };
    await runTool(quiet, { db, applicationId: appId, reason: "audit" }, undefined);
    // Today: NOT NULL constraint failed → appendTrace swallows it → the call
    // succeeded and left no trace at all.
    expect(listTrace(db, appId)).toHaveLength(1);
  });
});

describe("mark_submitted's consent gate reads the user's words, not the model's flag", () => {
  const atSubmitGate = () => {
    const task = createPipelineTask(db, { applicationId: appId });
    updatePipelineTask(db, task.id, { step: SUBMIT, status: "awaiting_user" });
    return task;
  };

  it("refuses when the model asserts confirmedByUser but the user never said so", async () => {
    const task = atSubmitGate();
    // The review scenario: a confused/nudged model writes its own consent.
    const ctx: ToolContext = {
      db,
      applicationId: appId,
      taskId: task.id,
      reason: "audit",
      latestUserMessage: "how is this application going?",
    };
    const obs = await runTool(markSubmittedTool, ctx, { confirmedByUser: true });
    expect(obs.ok).toBe(false);
    expect(obs.failure?.kind).toBe("human-gate");
    expect(getApplication(db, appId)?.status).not.toBe("applied");
  });

  it("refuses when no user message is in the context at all (e.g. a queue caller)", async () => {
    const task = atSubmitGate();
    const ctx: ToolContext = { db, applicationId: appId, taskId: task.id, reason: "audit" };
    const obs = await runTool(markSubmittedTool, ctx, { confirmedByUser: true });
    expect(obs.ok).toBe(false);
    expect(getApplication(db, appId)?.status).not.toBe("applied");
  });

  it("proceeds when the user's own message claims submission (English)", async () => {
    const task = atSubmitGate();
    const ctx: ToolContext = {
      db,
      applicationId: appId,
      taskId: task.id,
      reason: "audit",
      latestUserMessage: "I submitted it just now, please mark it",
    };
    const obs = await runTool(markSubmittedTool, ctx, { confirmedByUser: true });
    expect(obs.ok).toBe(true);
    expect(getApplication(db, appId)?.status).toBe("applied");
  });

  it("proceeds when the user's own message claims submission (Chinese)", async () => {
    const task = atSubmitGate();
    const ctx: ToolContext = {
      db,
      applicationId: appId,
      taskId: task.id,
      reason: "audit",
      latestUserMessage: "这个岗位我提交了，标记一下",
    };
    const obs = await runTool(markSubmittedTool, ctx, { confirmedByUser: true });
    expect(obs.ok).toBe(true);
    expect(getApplication(db, appId)?.status).toBe("applied");
  });

  it("an intention is not a claim: '要提交' / 'should I apply' do not pass", async () => {
    const task = atSubmitGate();
    for (const message of ["我打算要提交这个", "should I apply to this one?"]) {
      const ctx: ToolContext = {
        db,
        applicationId: appId,
        taskId: task.id,
        reason: "audit",
        latestUserMessage: message,
      };
      const obs = await runTool(markSubmittedTool, ctx, { confirmedByUser: true });
      expect(obs.ok).toBe(false);
    }
    expect(getApplication(db, appId)?.status).not.toBe("applied");
  });
});

describe("refine_artifact wraps the tweak seam and verifies a new version landed", () => {
  function seedResumeArtifact(taskId: string) {
    const now = Date.now();
    upsertArtifact(db, {
      id: "art-r",
      taskId,
      kind: "resume",
      versions: [{ id: "v1", content: "original résumé", rationale: "", createdAt: now }],
      currentVersionId: "v1",
      createdAt: now,
      updatedAt: now,
    });
  }

  it("refuses when there is no artifact to revise, as a precondition (not a crash)", async () => {
    const task = createPipelineTask(db, { applicationId: appId });
    const ctx: ToolContext = { db, applicationId: appId, taskId: task.id, reason: "audit" };
    const obs = await runTool(refineArtifactTool, ctx, {
      kind: "resume",
      instruction: "make it shorter",
    });
    expect(obs.ok).toBe(false);
    expect(obs.failure?.kind).toBe("precondition");
    expect(tweakArtifact).not.toHaveBeenCalled();
  });

  it("reports the new version and verifies it against the durable artifact", async () => {
    const task = createPipelineTask(db, { applicationId: appId });
    seedResumeArtifact(task.id);
    // The real tweak appends a version; mock that effect on the test DB.
    tweakArtifact.mockImplementationOnce(async () => {
      const art = getArtifact(db, task.id, "resume")!;
      const now = Date.now();
      upsertArtifact(db, {
        ...art,
        versions: [
          ...art.versions,
          { id: "v2", content: "shorter résumé", rationale: "", createdAt: now },
        ],
        currentVersionId: "v2",
        updatedAt: now,
      });
      return undefined;
    });
    const ctx: ToolContext = { db, applicationId: appId, taskId: task.id, reason: "audit" };
    const obs = await runTool(refineArtifactTool, ctx, {
      kind: "resume",
      instruction: "make it shorter",
    });
    expect(obs.ok).toBe(true);
    expect(obs.summary).toContain("v2");
    expect(tweakArtifact).toHaveBeenCalledOnce();
    // Durable check: the artifact really has 2 versions now.
    expect(getArtifact(db, task.id, "resume")!.versions).toHaveLength(2);
  });
});

describe("draft_answer grounds a proposed answer but refuses the user's-only questions", () => {
  it("refuses a work-authorization question as a human gate — no model call", async () => {
    const task = createPipelineTask(db, { applicationId: appId });
    runLlm.mockClear();
    const ctx: ToolContext = { db, applicationId: appId, taskId: task.id, reason: "audit" };
    const obs = await runTool(draftAnswerTool, ctx, {
      question: "Are you legally authorized to work in the United States?",
    });
    expect(obs.ok).toBe(false);
    expect(obs.failure?.kind).toBe("human-gate");
    expect(runLlm).not.toHaveBeenCalled();
  });

  it("drafts a grounded answer for an ordinary question, and does not save it", async () => {
    const task = createPipelineTask(db, { applicationId: appId });
    runLlm.mockResolvedValueOnce({ answer: "I'm drawn to your work on supply-chain AI." });
    const ctx: ToolContext = { db, applicationId: appId, taskId: task.id, reason: "audit" };
    const obs = await runTool(draftAnswerTool, ctx, {
      question: "Why do you want to work here?",
    });
    expect(obs.ok).toBe(true);
    expect((obs.result as { draft: string }).draft).toContain("supply-chain AI");
    expect(runLlm).toHaveBeenCalledWith(
      "question-answer",
      expect.objectContaining({ label: "Why do you want to work here?" }),
    );
    // Drafting must NOT write to the answer bank — that is save_answer's job.
    expect(listAnswers(db)).toHaveLength(0);
  });
});
