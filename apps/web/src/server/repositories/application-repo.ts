import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  applicationSchema,
  type Application,
  type ApplicationStatus,
  type JobInfo,
} from "@offeros/core";
import type { Db } from "../db/client";
import { applications } from "../db/schema";

type Row = typeof applications.$inferSelect;

function toDomain(row: Row): Application {
  return applicationSchema.parse({
    id: row.id,
    jobInfo: row.jobInfo,
    status: row.status,
    jdText: row.jdText ?? undefined,
    notes: row.notes ?? undefined,
    resumeId: row.resumeId ?? undefined,
    attachResume: row.attachResume ?? undefined,
    appliedAt: row.appliedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function listApplications(db: Db): Application[] {
  return db.select().from(applications).orderBy(desc(applications.updatedAt)).all().map(toDomain);
}

/** `origin + pathname` — drops query string and hash so tracking params
 *  (`?gh_src=…`) and a trailing `#` don't defeat the dedup match. Falls back
 *  to the raw string on an unparsable URL, so a malformed applyLink still
 *  compares (exactly, as before) instead of throwing. */
function normalizeJobUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** Dedup lookup for "Add this job": applications tracking the same job URL
 *  (jobInfo.applyLink), compared with query string/hash normalized away. */
export function listApplicationsByJobUrl(db: Db, jobUrl: string): Application[] {
  const target = normalizeJobUrl(jobUrl);
  return listApplications(db).filter(
    (a) => a.jobInfo.applyLink !== undefined && normalizeJobUrl(a.jobInfo.applyLink) === target,
  );
}

export function getApplication(db: Db, id: string): Application | null {
  const row = db.select().from(applications).where(eq(applications.id, id)).get();
  return row ? toDomain(row) : null;
}

export function createApplication(
  db: Db,
  input: {
    jobInfo: JobInfo;
    status?: ApplicationStatus;
    jdText?: string;
    attachResume?: Application["attachResume"];
  },
): Application {
  const now = Date.now();
  const row = {
    id: randomUUID(),
    jobInfo: input.jobInfo,
    status: input.status ?? ("saved" as ApplicationStatus),
    jdText: input.jdText ?? null,
    notes: null,
    resumeId: null,
    attachResume: input.attachResume ?? null,
    appliedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(applications).values(row).run();
  return toDomain(row as Row);
}

export function updateApplication(
  db: Db,
  id: string,
  // appliedAt additionally accepts null = clear (undoing a mark-as-submitted);
  // undefined still means "leave unchanged" like every other field.
  patch: Partial<Pick<Application, "status" | "notes" | "jdText" | "resumeId" | "attachResume">> & {
    appliedAt?: number | null;
  },
): Application | null {
  const existing = db.select().from(applications).where(eq(applications.id, id)).get();
  if (!existing) return null;
  db.update(applications)
    .set({
      status: patch.status ?? existing.status,
      notes: patch.notes ?? existing.notes,
      jdText: patch.jdText ?? existing.jdText,
      resumeId: patch.resumeId ?? existing.resumeId,
      attachResume: patch.attachResume ?? existing.attachResume,
      appliedAt: patch.appliedAt === null ? null : (patch.appliedAt ?? existing.appliedAt),
      updatedAt: Date.now(),
    })
    .where(eq(applications.id, id))
    .run();
  return getApplication(db, id);
}
