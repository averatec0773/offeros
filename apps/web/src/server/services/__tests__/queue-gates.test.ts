import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPELINE_STEPS } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import {
  createApplication,
  getApplication,
  updateApplication,
} from "../../repositories/application-repo";
import { createAgentTask, getAgentTask, updateAgentTask } from "../../repositories/agent-task-repo";
import { listEvents } from "../../repositories/application-event-repo";
import { makePipelineContext } from "../../pipeline/context";
import type { PipelineStep } from "../../pipeline/types";
import {
  runItemToGate,
  startQueue,
  queueStatus,
  __resetQueueForTests,
  type QueueDeps,
} from "../queue-service";

const SUBMIT_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "submit");

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-audit-queue-"));
  db = createDb(join(dir, "q.db"));
  __resetQueueForTests();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const steps = (): PipelineStep[] =>
  PIPELINE_STEPS.map(({ key }) => ({
    key,
    gate:
      key === "confirm-resume" || key === "confirm-cover-letter" ? ("confirm" as const) : undefined,
    shouldRun: () => true,
    run: async () => {},
  }));

const realDeps = (): QueueDeps => ({
  ctxFor: (taskId: string) => makePipelineContext(db, taskId, { steps: steps() }),
});

describe("run queue vs a task parked at the submit gate", () => {
  it("must not mark an application submitted on the user's behalf", async () => {
    // A task the extension already filled: parked at the submit gate, waiting
    // for the human "I've applied" click. Its application is `applying`, so
    // the homepage's eligible list (active && task.status !== "done") includes
    // it and the queue's door checks let it in.
    const app = createApplication(db, {
      jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
    });
    updateApplication(db, app.id, { status: "applying" });
    const task = createAgentTask(db, { applicationId: app.id });
    updateAgentTask(db, task.id, { status: "awaiting_user", step: SUBMIT_STEP });

    await runItemToGate(db, app.id, realDeps());

    const after = getAgentTask(db, task.id)!;
    const application = getApplication(db, app.id)!;
    const kinds = listEvents(db, app.id).map((e) => e.kind);

    expect(kinds).not.toContain("marked-submitted");
    expect(application.status).not.toBe("applied");
    expect(application.appliedAt ?? null).toBeNull();
    expect(after.status).toBe("awaiting_user");
    expect(PIPELINE_STEPS[after.step]?.key).toBe("submit");
  });
});

describe("run queue vs an item whose pipeline fails mid-run", () => {
  it("must report a failed task as failed, not as done", async () => {
    const app = createApplication(db, {
      jobInfo: { jobId: "j2", jobTitle: "ML Engineer", companyName: "Acme" },
    });
    // The real runner catches a step body throw, persists `failed`, and RETURNS
    // the task (it only rethrows a missing-provider-key error).
    const throwing = (): PipelineStep[] =>
      steps().map((s) =>
        s.key === "tailor-resume"
          ? {
              ...s,
              run: async () => {
                throw new Error("provider exploded");
              },
            }
          : s,
      );
    const deps: QueueDeps = {
      ctxFor: (taskId: string) => makePipelineContext(db, taskId, { steps: throwing() }),
    };

    startQueue(db, [app.id], deps);
    const deadline = Date.now() + 3000;
    while (queueStatus().state !== "idle" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const status = queueStatus();
    const kinds = listEvents(db, app.id).map((e) => e.kind);
    expect(status.done).not.toContain(app.id);
    expect(status.failed.map((f) => f.applicationId)).toContain(app.id);
    expect(kinds).toContain("queue-item-failed");
  });
});
