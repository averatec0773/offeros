import { eq, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { resumeSchema, type ResumeSummary } from "@offeros/core";
import { defaultStorageDir, type Db } from "../db/client";
import { resumes } from "../db/schema";
import { writeResumeFile } from "./resume-storage";

/**
 * A caller-facing precondition failure (bad mime type, oversize upload).
 * Distinct from an unexpected `Error` so the http envelope (matched by
 * `error.name`) maps it to a 400 while genuine bugs stay 500.
 */
export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

const MAX_RESUME_BYTES = 10 * 1024 * 1024;

type Row = typeof resumes.$inferSelect;

function toSummary(row: Row): ResumeSummary {
  return resumeSchema.parse({
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    isPrimary: row.isPrimary,
    targetRole: row.targetRole ?? undefined,
    note: row.note ?? undefined,
    text: row.text ?? undefined,
    createdAt: row.createdAt,
  });
}

/** Clears `isPrimary` on every resume row — the single-primary invariant is
 *  enforced by unconditionally clearing before setting the new one. */
function clearPrimaryFlag(db: Db): void {
  db.update(resumes).set({ isPrimary: false }).run();
}

export function listResumes(db: Db): ResumeSummary[] {
  return db.select().from(resumes).all().map(toSummary);
}

export interface UploadResumeInput {
  name: string;
  mimeType: string;
  dataBase64: string;
  isPrimary?: boolean;
  text?: string;
}

/**
 * Decode + store a resume upload under `~/.offeros/resumes/` (or the injected
 * `storageDir`), naming the file from a freshly generated id — never the
 * client-supplied `name` — so a malicious name can never escape storageDir.
 */
export function uploadResume(
  db: Db,
  input: UploadResumeInput,
  options?: { storageDir?: string },
): ResumeSummary {
  if (input.mimeType !== "application/pdf") {
    throw new ServiceError("resume must be a PDF (application/pdf)");
  }
  const data = Buffer.from(input.dataBase64, "base64");
  if (data.length > MAX_RESUME_BYTES) {
    throw new ServiceError("resume exceeds the 10 MB size limit");
  }

  const id = randomUUID();
  const storageDir = options?.storageDir ?? defaultStorageDir();
  const filePath = writeResumeFile(storageDir, id, input.mimeType, data);
  const now = Date.now();

  if (input.isPrimary) clearPrimaryFlag(db);

  const row: Row = {
    id,
    name: input.name,
    mimeType: input.mimeType,
    isPrimary: input.isPrimary ?? false,
    targetRole: null,
    note: null,
    text: input.text ?? "",
    filePath,
    createdAt: now,
  };
  db.insert(resumes).values(row).run();
  return toSummary(row);
}

/** Sets `isPrimary`; when true, clears the flag on every other resume first
 *  so exactly one resume is ever primary. Null when `id` doesn't exist. */
export function setPrimaryResume(db: Db, id: string, isPrimary: boolean): ResumeSummary | null {
  const existing = db.select().from(resumes).where(eq(resumes.id, id)).get();
  if (!existing) return null;
  if (isPrimary) clearPrimaryFlag(db);
  db.update(resumes).set({ isPrimary }).where(eq(resumes.id, id)).run();
  return toSummary({ ...existing, isPrimary });
}

/**
 * Renames a resume, sets its note, and/or toggles its primary flag in one
 * patch. Setting `isPrimary: true` clears the flag on every other resume first
 * (reusing `clearPrimaryFlag`) so exactly one resume is ever primary. Fields
 * left out of `patch` keep their current value — passing `note: ""` clears it.
 * Null when `id` doesn't exist.
 */
export function updateResume(
  db: Db,
  id: string,
  patch: { name?: string; note?: string; isPrimary?: boolean },
): ResumeSummary | null {
  const existing = db.select().from(resumes).where(eq(resumes.id, id)).get();
  if (!existing) return null;
  if (patch.isPrimary === true) clearPrimaryFlag(db);
  const next = {
    name: patch.name ?? existing.name,
    note: patch.note !== undefined ? patch.note : existing.note,
    isPrimary: patch.isPrimary ?? existing.isPrimary,
  };
  db.update(resumes).set(next).where(eq(resumes.id, id)).run();
  return toSummary({ ...existing, ...next });
}

/** Deletes the row and its stored file (if any). False if `id` doesn't exist.
 *  If the deleted resume was primary, auto-promotes the most recently uploaded
 *  remaining resume by setting isPrimary: true. No-op if none remain. */
export function deleteResume(db: Db, id: string): boolean {
  const existing = db.select().from(resumes).where(eq(resumes.id, id)).get();
  if (!existing) return false;
  db.delete(resumes).where(eq(resumes.id, id)).run();
  if (existing.filePath) {
    try {
      unlinkSync(existing.filePath);
    } catch {
      // Already gone — nothing left to clean up.
    }
  }

  // Auto-promote the newest remaining resume if we deleted the primary.
  if (existing.isPrimary) {
    const newest = db.select().from(resumes).orderBy(desc(resumes.createdAt)).limit(1).get();
    if (newest) {
      db.update(resumes).set({ isPrimary: true }).where(eq(resumes.id, newest.id)).run();
    }
  }

  return true;
}
