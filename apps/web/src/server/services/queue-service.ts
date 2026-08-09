import { PIPELINE_STEPS, type AgentTask } from "@offeros/core";
import type { Db } from "../db/client";
import type { PipelineContext } from "../pipeline/types";
import { startTask, advance, choose } from "../pipeline/runner";
import { getAgentTaskByApplicationId } from "../repositories/agent-task-by-application";
import { createAgentTask } from "../repositories/agent-task-repo";
import { getApplication } from "../repositories/application-repo";
import { appendEvent } from "../repositories/application-event-repo";
import { findConflicts, type ApplicantConstraints } from "@offeros/autofill";
import { listAnswerBank } from "./fill-service";
import { runTool } from "../agent/run-tool";
import type { Tool } from "../agent/types";

/**
 * The run queue: batch-apply over many applications, one at a time. Each item
 * runs its pipeline forward until a HUMAN gate (fill-form or submit) — confirm
 * gates auto-approve, the optional-cover-letter choice defaults to skip (the
 * workspace and panel can still generate one later). The queue lives in
 * process memory: the durable truth is still each task's own state, so a
 * server restart merely forgets the *ordering*, never any work.
 *
 * Door checks at enqueue: only saved/applying applications whose task isn't
 * already finished get in — bad items are reported back with a reason instead
 * of being silently swallowed (no silent caps, no dead queues).
 */

export interface QueueSkip {
  applicationId: string;
  reason: string;
}

export interface QueueFailure {
  applicationId: string;
  reason: string;
}

export interface QueueStatus {
  state: "idle" | "running" | "paused";
  queued: string[];
  current: string | null;
  done: string[];
  failed: QueueFailure[];
}

interface QueueState {
  state: "idle" | "running" | "paused";
  queued: string[];
  current: string | null;
  done: string[];
  failed: QueueFailure[];
  looping: boolean;
}

// Pinned on globalThis so dev hot-reload doesn't orphan a running loop's state.
const globalScope = globalThis as { __offerosRunQueue?: QueueState };
const q = (globalScope.__offerosRunQueue ??= {
  state: "idle",
  queued: [],
  current: null,
  done: [],
  failed: [],
  looping: false,
});

export interface QueueDeps {
  ctxFor: (taskId: string) => PipelineContext;
  runner?: {
    startTask: typeof startTask;
    advance: typeof advance;
    choose: typeof choose;
  };
}

const HUMAN_GATES = new Set(["fill-form", "submit"]);

/**
 * The applicant's dealbreakers, read from answers they already committed to.
 * Derived rather than configured: they answered "do you require sponsorship"
 * once, and that answer is the constraint — asking again in a settings screen
 * would be a second place for the same fact to go stale.
 */
function applicantConstraints(db: Db): ApplicantConstraints {
  const bank = listAnswerBank(db);
  const sponsorship = bank.find((a) => a.questionPatterns.some((p) => /sponsor/i.test(p)));
  return {
    needsSponsorship: sponsorship ? /^\s*yes\b/i.test(sponsorship.answer) : false,
  };
}

/**
 * One queue item, expressed as a tool so the batch run lands on the agent
 * trace like everything else: what it did to each application, whether the
 * task actually moved, and where it stopped.
 */
const queueItemTool: Tool<{ deps: QueueDeps }, { stoppedAt: string; taskStatus: string }> = {
  id: "queue_item",
  description: "Run one queued application forward to its next human gate.",
  parse: (input) => input as { deps: QueueDeps },
  run: async (ctx, { deps }) => {
    const t = await runItemToGate(ctx.db, ctx.applicationId, deps);
    const stoppedAt = PIPELINE_STEPS[t.step]?.key ?? "end";
    if (t.status === "failed") {
      return {
        ok: false,
        summary: `stopped: ${t.failureReason ?? "step failed"}`,
        failure: { kind: "dependency", reason: t.failureReason ?? "step failed" },
      };
    }
    return {
      ok: true,
      summary: atHumanGate(t) ? `waiting for you at ${stoppedAt}` : `ran to ${stoppedAt}`,
      result: { stoppedAt, taskStatus: t.status },
    };
  },
  // Nothing independent to check: runItemToGate creates the task when it is
  // missing, so asserting one exists would be a tautology dressed as proof.
  // The task's own status is already what `run` reported on.
  verify: async () => null,
};

export function queueStatus(): QueueStatus {
  return {
    state: q.state,
    queued: [...q.queued],
    current: q.current,
    done: [...q.done],
    failed: [...q.failed],
  };
}

export function pauseQueue(): QueueStatus {
  if (q.state === "running") q.state = "paused";
  return queueStatus();
}

/**
 * Enqueue eligible applications and start (or resume) the loop. Returns the
 * new status plus per-application skip reasons for everything refused at the
 * door.
 */
export function startQueue(
  db: Db,
  applicationIds: string[],
  deps: QueueDeps,
): {
  status: QueueStatus;
  skipped: QueueSkip[];
} {
  const skipped: QueueSkip[] = [];
  for (const id of applicationIds) {
    if (q.queued.includes(id) || q.current === id) {
      skipped.push({ applicationId: id, reason: "already queued" });
      continue;
    }
    const application = getApplication(db, id);
    if (!application) {
      skipped.push({ applicationId: id, reason: "application not found" });
      continue;
    }
    if (application.status !== "saved" && application.status !== "applying") {
      skipped.push({ applicationId: id, reason: `application is ${application.status}` });
      continue;
    }
    const task = getAgentTaskByApplicationId(db, id);
    if (task && (task.status === "done" || task.status === "failed")) {
      skipped.push({ applicationId: id, reason: `task already ${task.status}` });
      continue;
    }
    // Dealbreakers before effort: a posting that rules the applicant out is
    // not worth a tailoring call. Said out loud with the posting's own words —
    // postings are sometimes wrong, and the user can still open it by hand.
    const conflicts = findConflicts(
      `${application.jobInfo.jobTitle} ${application.jdText ?? ""}`,
      applicantConstraints(db),
    );
    if (conflicts.length > 0) {
      skipped.push({ applicationId: id, reason: conflicts[0]!.reason });
      appendEvent(db, {
        applicationId: id,
        kind: "constraint-conflict",
        payload: { kind: conflicts[0]!.kind, evidence: conflicts[0]!.evidence },
      });
      continue;
    }
    if (task && atHumanGate(task)) {
      // Waiting on the browser (fill) or on the user (submit) — the queue has
      // nothing to contribute and must not step through the gate for them.
      skipped.push({
        applicationId: id,
        reason: `waiting for you at ${PIPELINE_STEPS[task.step]?.label ?? "a gate"}`,
      });
      continue;
    }
    q.queued.push(id);
    appendEvent(db, { applicationId: id, kind: "queued" });
  }
  // A fresh start clears the previous run's bookkeeping so counts read clean.
  if (q.state === "idle") {
    q.done = [];
    q.failed = [];
  }
  q.state = q.queued.length > 0 || q.current ? "running" : q.state;
  void runLoop(db, deps);
  return { status: queueStatus(), skipped };
}

/** True when the task is parked at a gate only a human may move past. */
function atHumanGate(task: AgentTask): boolean {
  return task.status === "awaiting_user" && HUMAN_GATES.has(PIPELINE_STEPS[task.step]?.key ?? "");
}

/** Run one task forward to its next human gate. Exported for tests. */
export async function runItemToGate(
  db: Db,
  applicationId: string,
  deps: QueueDeps,
): Promise<AgentTask> {
  const runner = deps.runner ?? { startTask, advance, choose };
  const existing = getAgentTaskByApplicationId(db, applicationId);
  const task = existing ?? createAgentTask(db, { applicationId });
  // Nothing to run: the task already waits on a human. This check MUST come
  // before the first advance() — at the submit gate advance() *is* "mark as
  // submitted", so starting the queue on such a task would close it and flag
  // the application applied without anyone clicking anything.
  if (atHumanGate(task)) return task;
  const ctx = deps.ctxFor(task.id);

  let t = task.status === "queued" ? await runner.startTask(ctx) : await runner.advance(ctx);
  // Auto-approve confirm gates; a choice gate (advance() no-ops there) gets
  // the queue default: skip the optional cover letter. The guard bound is a
  // backstop far above the real gate count.
  for (let guard = 0; guard < 12; guard += 1) {
    if (t.status !== "awaiting_user") break;
    const key = PIPELINE_STEPS[t.step]?.key ?? "";
    if (HUMAN_GATES.has(key)) break;
    const before = `${t.step}|${t.status}`;
    t = await runner.advance(ctx);
    if (`${t.step}|${t.status}` === before) t = await runner.choose(ctx, "skip");
    if (`${t.step}|${t.status}` === before) break; // no progress — never spin
  }
  return t;
}

async function runLoop(db: Db, deps: QueueDeps): Promise<void> {
  if (q.looping) return; // single consumer
  q.looping = true;
  try {
    while (q.state === "running" && q.queued.length > 0) {
      const applicationId = q.queued.shift()!;
      q.current = applicationId;
      // Every queue item runs as a tool, so the batch lands on the agent trace
      // and inherits the contract: a thrown error and a task that persisted
      // `failed` both arrive here as the same failure observation, and the
      // loop no longer needs its own try/catch to tell them apart. (The runner
      // swallows step-body errors and RETURNS a failed task; only a missing
      // API key propagates — reading one channel used to miss the other.)
      const obs = await runTool(
        queueItemTool,
        { db, applicationId, reason: "run queue" },
        { deps },
      );
      if (obs.ok) {
        const t = getAgentTaskByApplicationId(db, applicationId);
        q.done.push(applicationId);
        appendEvent(db, {
          applicationId,
          kind: "queue-processed",
          payload: {
            stoppedAt: t ? (PIPELINE_STEPS[t.step]?.key ?? "end") : "end",
            taskStatus: t?.status ?? "unknown",
          },
        });
      } else {
        const reason = obs.failure?.reason ?? "step failed";
        q.failed.push({ applicationId, reason });
        appendEvent(db, { applicationId, kind: "queue-item-failed", payload: { reason } });
      }
      q.current = null;
    }
  } finally {
    q.looping = false;
    if (q.queued.length === 0 && q.state === "running") q.state = "idle";
  }
}

/** Test-only: reset the module-level queue between cases. */
export function __resetQueueForTests(): void {
  q.state = "idle";
  q.queued = [];
  q.current = null;
  q.done = [];
  q.failed = [];
  q.looping = false;
}
