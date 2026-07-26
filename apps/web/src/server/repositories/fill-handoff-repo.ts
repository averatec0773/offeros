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

export function getFillHandoff(db: Db, id: string): FillHandoff | null {
  const row = db.select().from(fillHandoffs).where(eq(fillHandoffs.id, id)).get();
  return row ? toDomain(row) : null;
}

export function listOpenFillHandoffs(db: Db): FillHandoff[] {
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
