import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { fillHandoffSchema, type FillHandoff } from "@offeros/core";
import type { Db } from "../db/client";
import { fillHandoffs } from "../db/schema";

type Row = typeof fillHandoffs.$inferSelect;

function toDomain(row: Row): FillHandoff {
  return fillHandoffSchema.parse({
    id: row.id,
    taskId: row.taskId,
    applicationId: row.applicationId,
    applyLink: row.applyLink ?? undefined,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

const OPEN_STATUSES = ["pending", "claimed"] as const;

/**
 * How long a fill ticket stays meaningful.
 *
 * A ticket was closed by exactly three things: a newer ticket for the same
 * task, a completed report, or the user resolving the fill. Nothing else — so a
 * panel that sent one incremental report and then crashed, or a tab the user
 * simply closed, left a ticket open forever. Those tickets kept the application
 * in the extension's pending list and in the inbox as "open the page to fill
 * it", permanently, for a fill that ended weeks ago.
 *
 * A week is well past the point where a ticket describes anything real. It is
 * long enough that a genuinely paused application (opened Friday, finished
 * Monday) survives, and short enough that abandoned ones do not accumulate.
 */
const HANDOFF_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Expire stale open tickets, lazily, on the read paths that would otherwise
 * report them as live.
 *
 * Deliberately read-time rather than a scheduled sweep: this is a local
 * single-user app with no daemon, and a cron job would be a whole moving part
 * added to solve a problem that only manifests when someone looks. The write is
 * idempotent — a ticket already cancelled is not touched again.
 */
export function expireStaleHandoffs(db: Db, now: number = Date.now()): number {
  const cutoff = now - HANDOFF_TTL_MS;
  const stale = db
    .select()
    .from(fillHandoffs)
    .where(inArray(fillHandoffs.status, OPEN_STATUSES))
    .all()
    .filter((row) => row.updatedAt < cutoff);
  for (const row of stale) {
    db.update(fillHandoffs)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(fillHandoffs.id, row.id))
      .run();
  }
  return stale.length;
}

export function getFillHandoff(db: Db, id: string): FillHandoff | null {
  expireStaleHandoffs(db);
  const row = db.select().from(fillHandoffs).where(eq(fillHandoffs.id, id)).get();
  return row ? toDomain(row) : null;
}

export function listOpenFillHandoffs(db: Db): FillHandoff[] {
  expireStaleHandoffs(db);
  return db
    .select()
    .from(fillHandoffs)
    .where(inArray(fillHandoffs.status, OPEN_STATUSES))
    .orderBy(desc(fillHandoffs.createdAt), desc(sql`rowid`))
    .all()
    .map(toDomain);
}

/** Cancels any open (pending/claimed) handoff for the same taskId, then inserts a new pending one. */
export function createFillHandoff(
  db: Db,
  input: { taskId: string; applicationId: string; applyLink?: string },
): FillHandoff {
  db.update(fillHandoffs)
    .set({ status: "cancelled", updatedAt: Date.now() })
    .where(and(eq(fillHandoffs.taskId, input.taskId), inArray(fillHandoffs.status, OPEN_STATUSES)))
    .run();

  const now = Date.now();
  const row = {
    id: randomUUID(),
    taskId: input.taskId,
    applicationId: input.applicationId,
    applyLink: input.applyLink ?? null,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  db.insert(fillHandoffs).values(row).run();
  return toDomain(row as Row);
}

export function updateFillHandoff(
  db: Db,
  id: string,
  patch: Partial<Pick<FillHandoff, "status">>,
): FillHandoff | null {
  const existing = db.select().from(fillHandoffs).where(eq(fillHandoffs.id, id)).get();
  if (!existing) return null;
  db.update(fillHandoffs)
    .set({
      status: patch.status ?? existing.status,
      updatedAt: Date.now(),
    })
    .where(eq(fillHandoffs.id, id))
    .run();
  return getFillHandoff(db, id);
}
