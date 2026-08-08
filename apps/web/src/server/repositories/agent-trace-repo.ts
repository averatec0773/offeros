import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { agentTrace } from "../db/schema";
import type { TraceEntry } from "../agent/types";

/**
 * The agent's trace. Like `appendEvent`, writing here NEVER throws: a tool
 * call must not fail because its bookkeeping did. Unlike events (the human
 * timeline), a trace row is per tool call and carries the verification verdict
 * — it is what a policy replays and what an eval harness scores.
 */
export function appendTrace(db: Db, entry: Omit<TraceEntry, "id" | "at">): void {
  try {
    db.insert(agentTrace)
      .values({
        id: randomUUID(),
        applicationId: entry.applicationId,
        taskId: entry.taskId ?? null,
        tool: entry.tool,
        reason: entry.reason ?? null,
        ok: entry.ok,
        summary: entry.summary,
        failureKind: entry.failureKind ?? null,
        failureReason: entry.failureReason ?? null,
        verified: entry.verified ?? null,
        durationMs: entry.durationMs,
        at: Date.now(),
      })
      .run();
  } catch (error) {
    console.error("[agent-trace-repo] appendTrace failed:", error);
  }
}

export function listTrace(db: Db, applicationId: string): TraceEntry[] {
  const rows = db
    .select()
    .from(agentTrace)
    .where(eq(agentTrace.applicationId, applicationId))
    .orderBy(asc(agentTrace.at))
    .all();
  return rows.map((r) => ({
    id: r.id,
    applicationId: r.applicationId,
    taskId: r.taskId ?? undefined,
    tool: r.tool,
    reason: r.reason ?? undefined,
    ok: r.ok,
    summary: r.summary,
    failureKind: (r.failureKind as TraceEntry["failureKind"]) ?? undefined,
    failureReason: r.failureReason ?? undefined,
    verified: r.verified ?? undefined,
    durationMs: r.durationMs,
    at: r.at,
  }));
}
