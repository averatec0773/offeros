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
import { upsertArtifact } from "../../repositories/artifact-repo";
import { listTrace } from "../../repositories/agent-trace-repo";
import { runTool } from "../run-tool";
import type { Tool, ToolContext } from "../types";

const runTargetedStep = vi.fn(async () => undefined);
vi.mock("../../pipeline/runner", () => ({
  runTargetedStep: (...a: unknown[]) => runTargetedStep(...(a as [])),
  startTask: vi.fn(),
  advance: vi.fn(),
  choose: vi.fn(),
}));
vi.mock("../../pipeline/route-context", () => ({ buildPipelineContext: () => ({}) }));

const { markSubmittedTool, tailorResumeTool } = await import("../tools");

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
