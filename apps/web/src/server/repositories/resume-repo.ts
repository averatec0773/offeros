import { eq, desc } from "drizzle-orm";
import type { Db } from "../db/client";
import { resumes } from "../db/schema";

/**
 * Row-level data access for the résumé aggregate — no business rules here.
 * The single-primary invariant, upload validation, and file-storage
 * orchestration live in `services/resume-service.ts`; this module is the only
 * place that touches the `resumes` table. (It was the one aggregate without a
 * repository — the service carried raw SQL — until a structure audit flagged
 * it.)
 */

export type ResumeRow = typeof resumes.$inferSelect;

export function getResumeRow(db: Db, id: string): ResumeRow | null {
  return db.select().from(resumes).where(eq(resumes.id, id)).get() ?? null;
}

export function listResumeRows(db: Db): ResumeRow[] {
  return db.select().from(resumes).all();
}

export function insertResumeRow(db: Db, row: ResumeRow): void {
  db.insert(resumes).values(row).run();
}

export function updateResumeRow(db: Db, id: string, patch: Partial<Omit<ResumeRow, "id">>): void {
  db.update(resumes).set(patch).where(eq(resumes.id, id)).run();
}

export function deleteResumeRow(db: Db, id: string): void {
  db.delete(resumes).where(eq(resumes.id, id)).run();
}

/** Clears `isPrimary` on every row — the service enforces single-primary by
 *  clearing unconditionally before setting the new one. */
export function clearPrimaryFlag(db: Db): void {
  db.update(resumes).set({ isPrimary: false }).run();
}

/** The most recently uploaded row (createdAt, then id, descending). */
export function newestResumeRow(db: Db): ResumeRow | null {
  return (
    db.select().from(resumes).orderBy(desc(resumes.createdAt), desc(resumes.id)).limit(1).get() ??
    null
  );
}
