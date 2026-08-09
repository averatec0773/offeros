/**
 * Adversarial audit of the campaign console (`attention-service.ts` and the
 * trace feed it renders). Every case here FAILS today.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPELINE_STEPS, type AgentTask } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import { createApplication } from "../../repositories/application-repo";
import { createAgentTask, updateAgentTask } from "../../repositories/agent-task-repo";
import { appendTrace, listRecentTrace } from "../../repositories/agent-trace-repo";
import { buildInbox } from "../attention-service";
import { runItemToGate, __resetQueueForTests } from "../queue-service";

const FILL = PIPELINE_STEPS.findIndex((s) => s.key === "fill-form");
const SUBMIT = PIPELINE_STEPS.findIndex((s) => s.key === "submit");

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-audit-console-"));
  db = createDb(join(dir, "t.db"));
  __resetQueueForTests();
});
afterEach(() => {
  __resetQueueForTests();
  rmSync(dir, { recursive: true, force: true });
});

function seed(title: string): string {
  return createApplication(db, {
    jobInfo: { jobId: `j-${title}`, jobTitle: title, companyName: "Acme" },
  }).id;
}

describe("B1 — the inbox must read the CURRENT task of an application", () => {
  it("does not report a superseded task's state", async () => {
    const id = seed("AI Engineer");
    // `POST /api/v1/agent/tasks` creates a task per call with no dedup, so an
    // application can hold more than one. Every other reader
    // (getAgentTaskByApplicationId) takes the newest; buildInbox takes the oldest.
    const old = createAgentTask(db, { applicationId: id });
    updateAgentTask(db, old.id, { status: "failed", failureReason: "provider down" });
    await new Promise((r) => setTimeout(r, 20)); // distinct updatedAt, no tie
    const fresh = createAgentTask(db, { applicationId: id });
    updateAgentTask(db, fresh.id, { step: SUBMIT, status: "awaiting_user" });

    expect(buildInbox(db).map((i) => i.kind)).toEqual(["ready-to-submit"]);
  });
});

describe("B2 — a fill gate the browser has never touched is the user's turn", () => {
  it("lists an application the queue parked at the fill gate with no report", async () => {
    const id = seed("AI Engineer");
    const task = createAgentTask(db, { applicationId: id });
    const park = async (): Promise<AgentTask> => {
      updateAgentTask(db, task.id, { step: FILL, status: "awaiting_user" });
      return { ...task, step: FILL, status: "awaiting_user" } as AgentTask;
    };
    await runItemToGate(db, id, {
      ctxFor: () => ({}) as never,
      runner: { startTask: park, advance: park, choose: park } as never,
    });

    // applicationInfo is undefined: no fill has ever run. Nothing will happen
    // until the person opens the side panel on the apply page — yet the console
    // renders "Nothing needs you / everything is moving on its own".
    expect(buildInbox(db)).toHaveLength(1);
  });
});

describe("B3 — an application whose task was created but never started", () => {
  it("is still listed as not-started", () => {
    const id = seed("AI Engineer");
    createAgentTask(db, { applicationId: id }); // status "queued"
    // `!task` is the only not-started trigger, so the JD-source seam (which
    // creates application + queued task in one POST) produces an application
    // that is in no bucket at all.
    expect(buildInbox(db).map((i) => i.kind)).toEqual(["not-started"]);
  });
});

describe("B4 — inbox ordering claims 'most recently touched first'", () => {
  it("sorts by when the task last moved, not when the application row changed", async () => {
    const a = seed("Older");
    await new Promise((r) => setTimeout(r, 20));
    const b = seed("Newer");
    const ta = createAgentTask(db, { applicationId: a });
    const tb = createAgentTask(db, { applicationId: b });
    updateAgentTask(db, tb.id, { status: "failed", failureReason: "b broke" });
    await new Promise((r) => setTimeout(r, 20));
    updateAgentTask(db, ta.id, { status: "failed", failureReason: "a broke" });

    // `at` is application.updatedAt, which nothing in the pipeline touches.
    expect(buildInbox(db).map((i) => i.jobTitle)).toEqual(["Older", "Newer"]);
  });
});

describe("B5 — listRecentTrace is 'the newest N, newest first'", () => {
  it("orders and truncates correctly when rows share the same millisecond", () => {
    const id = seed("AI Engineer");
    for (const tool of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      appendTrace(db, { applicationId: id, tool, ok: true, summary: tool, durationMs: 0 });
    }
    // `at` is Date.now() and `id` is a random UUID — there is no tiebreaker, so
    // SQLite's ORDER BY at DESC is free to return any permutation of a tie.
    expect(listRecentTrace(db, 40).map((t) => t.tool)).toEqual([
      "h",
      "g",
      "f",
      "e",
      "d",
      "c",
      "b",
      "a",
    ]);
    expect(listRecentTrace(db, 3).map((t) => t.tool)).toEqual(["h", "g", "f"]);
  });
});
