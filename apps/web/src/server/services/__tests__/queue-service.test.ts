import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPELINE_STEPS } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import { createApplication, updateApplication } from "../../repositories/application-repo";
import { getAgentTaskByApplicationId } from "../../repositories/agent-task-by-application";
import { updateAgentTask } from "../../repositories/agent-task-repo";
import { listEvents } from "../../repositories/application-event-repo";
import {
  startQueue,
  queueStatus,
  pauseQueue,
  runItemToGate,
  __resetQueueForTests,
  type QueueDeps,
} from "../queue-service";
import type { PipelineContext } from "../../pipeline/types";

const FILL_FORM_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "fill-form");
const CONFIRM_RESUME_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "confirm-resume");
const CHOICE_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "generate-cover-letter");

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-queue-"));
  db = createDb(join(dir, "t.db"));
  __resetQueueForTests();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seedApplication(status: "saved" | "applying" | "applied" = "saved"): string {
  const app = createApplication(db, {
    jobInfo: { jobId: `j-${Math.random()}`, jobTitle: "Engineer", companyName: "Acme" },
    jdText: "jd",
  });
  if (status !== "saved") updateApplication(db, app.id, { status });
  return app.id;
}

/**
 * A scripted fake runner: startTask parks the task at confirm-resume,
 * advance moves confirm-resume → the choice step (where it then no-ops, like
 * the real runner), choose("skip") jumps to the fill gate.
 */
function fakeDeps(): QueueDeps {
  const ctxFor = (taskId: string) => ({ taskId }) as unknown as PipelineContext;
  return {
    ctxFor,
    runner: {
      startTask: async (ctx: PipelineContext) =>
        updateAgentTask(db, ctx.taskId, { status: "awaiting_user", step: CONFIRM_RESUME_STEP })!,
      advance: async (ctx: PipelineContext) => {
        const t = (await import("../../repositories/agent-task-repo")).getAgentTask(
          db,
          ctx.taskId,
        )!;
        if (t.step === CONFIRM_RESUME_STEP) {
          return updateAgentTask(db, ctx.taskId, { step: CHOICE_STEP, status: "awaiting_user" })!;
        }
        return t; // choice gate: no-op, like the real advance()
      },
      choose: async (ctx: PipelineContext) =>
        updateAgentTask(db, ctx.taskId, { step: FILL_FORM_STEP, status: "awaiting_user" })!,
    },
  };
}

const waitForIdle = async () => {
  const deadline = Date.now() + 2000;
  while (queueStatus().state !== "idle" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("startQueue door checks", () => {
  it("refuses missing, terminal-status, and duplicate applications with reasons", async () => {
    const applied = seedApplication("applied");
    const good = seedApplication("saved");
    const { skipped } = startQueue(db, [applied, good, good, "ghost"], fakeDeps());
    await waitForIdle();
    const reasons = Object.fromEntries(skipped.map((s) => [s.applicationId, s.reason]));
    expect(reasons[applied]).toBe("application is applied");
    expect(reasons["ghost"]).toBe("application not found");
    // The duplicate of `good`: either still queued or already processed when
    // the second copy arrives — both read as a skip.
    expect(skipped.some((s) => s.applicationId === good)).toBe(true);
  });
});

describe("runItemToGate", () => {
  it("creates the task, auto-approves confirm gates, skips the choice, stops at fill-form", async () => {
    const appId = seedApplication();
    const task = await runItemToGate(db, appId, fakeDeps());
    expect(task.status).toBe("awaiting_user");
    expect(PIPELINE_STEPS[task.step]?.key).toBe("fill-form");
  });
});

describe("queue loop", () => {
  it("processes sequentially to the human gate and records queue events", async () => {
    const a = seedApplication();
    const b = seedApplication();
    startQueue(db, [a, b], fakeDeps());
    await waitForIdle();

    const status = queueStatus();
    expect(status.state).toBe("idle");
    expect(status.done).toEqual([a, b]);
    expect(status.failed).toEqual([]);
    for (const id of [a, b]) {
      const task = getAgentTaskByApplicationId(db, id)!;
      expect(PIPELINE_STEPS[task.step]?.key).toBe("fill-form");
      const kinds = listEvents(db, id).map((e) => e.kind);
      expect(kinds).toContain("queued");
      expect(kinds).toContain("queue-processed");
    }
  });

  it("captures a failing item with its reason and keeps going", async () => {
    const bad = seedApplication();
    const good = seedApplication();
    const deps = fakeDeps();
    const failingDeps: QueueDeps = {
      ...deps,
      runner: {
        ...deps.runner!,
        startTask: async (ctx: PipelineContext) => {
          const t = (await import("../../repositories/agent-task-repo")).getAgentTask(
            db,
            ctx.taskId,
          )!;
          if (t.applicationId === bad) throw new Error("provider exploded");
          return deps.runner!.startTask(ctx);
        },
      },
    };
    startQueue(db, [bad, good], failingDeps);
    await waitForIdle();
    const status = queueStatus();
    expect(status.failed.map((f) => f.applicationId)).toEqual([bad]);
    expect(status.done).toEqual([good]);
    expect(listEvents(db, bad).map((e) => e.kind)).toContain("queue-item-failed");
  });

  it("pause stops after the in-flight item; restart resumes the remainder", async () => {
    const a = seedApplication();
    const b = seedApplication();
    const deps = fakeDeps();
    const slowDeps: QueueDeps = {
      ...deps,
      runner: {
        ...deps.runner!,
        startTask: async (ctx: PipelineContext) => {
          await new Promise((r) => setTimeout(r, 50));
          return deps.runner!.startTask(ctx);
        },
      },
    };
    startQueue(db, [a, b], slowDeps);
    pauseQueue(); // a is in flight; b must stay queued
    const deadline = Date.now() + 2000;
    while (queueStatus().current !== null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    let status = queueStatus();
    expect(status.state).toBe("paused");
    expect(status.done).toEqual([a]);
    expect(status.queued).toEqual([b]);

    startQueue(db, [], slowDeps); // resume with nothing new
    await waitForIdle();
    status = queueStatus();
    expect(status.done).toEqual([a, b]);
  });
});
