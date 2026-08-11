import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { pipelineTaskSchema, type PipelineTask } from "@offeros/core";
import type { Db } from "../db/client";
import { pipelineTasks } from "../db/schema";

type Row = typeof pipelineTasks.$inferSelect;

export function toDomain(row: Row): PipelineTask {
  return pipelineTaskSchema.parse({
    id: row.id,
    applicationId: row.applicationId,
    status: row.status,
    step: row.step,
    applicationInfo: row.applicationInfo ?? undefined,
    resumeId: row.resumeId ?? undefined,
    coverLetterId: row.coverLetterId ?? undefined,
    coverLetterRequirement: row.coverLetterRequirement,
    skippedCoverLetter: row.skippedCoverLetter,
    fillFirst: row.fillFirst,
    fieldReports: row.fieldReports ?? undefined,
    failureReason: row.failureReason ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function listPipelineTasks(db: Db): PipelineTask[] {
  return db.select().from(pipelineTasks).orderBy(desc(pipelineTasks.updatedAt)).all().map(toDomain);
}

export function getPipelineTask(db: Db, id: string): PipelineTask | null {
  const row = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, id)).get();
  return row ? toDomain(row) : null;
}

export function createPipelineTask(
  db: Db,
  input: {
    applicationId: string;
    status?: PipelineTask["status"];
    step?: number;
    fillFirst?: boolean;
  },
): PipelineTask {
  const now = Date.now();
  const row = {
    id: randomUUID(),
    applicationId: input.applicationId,
    status: input.status ?? "queued",
    step: input.step ?? 0,
    applicationInfo: null,
    resumeId: null,
    coverLetterId: null,
    coverLetterRequirement: "unknown",
    skippedCoverLetter: false,
    fillFirst: input.fillFirst ?? false,
    fieldReports: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(pipelineTasks).values(row).run();
  return toDomain(row as Row);
}

export function updatePipelineTask(
  db: Db,
  id: string,
  patch: Partial<
    Pick<
      PipelineTask,
      | "status"
      | "step"
      | "applicationInfo"
      | "resumeId"
      | "coverLetterId"
      | "coverLetterRequirement"
      | "skippedCoverLetter"
      | "fieldReports"
      | "failureReason"
    >
  >,
): PipelineTask | null {
  const existing = db.select().from(pipelineTasks).where(eq(pipelineTasks.id, id)).get();
  if (!existing) return null;
  db.update(pipelineTasks)
    .set({
      status: patch.status ?? existing.status,
      step: patch.step ?? existing.step,
      applicationInfo: patch.applicationInfo ?? existing.applicationInfo,
      resumeId: patch.resumeId ?? existing.resumeId,
      coverLetterId: patch.coverLetterId ?? existing.coverLetterId,
      coverLetterRequirement: patch.coverLetterRequirement ?? existing.coverLetterRequirement,
      skippedCoverLetter: patch.skippedCoverLetter ?? existing.skippedCoverLetter,
      fieldReports: patch.fieldReports ?? existing.fieldReports,
      failureReason: patch.failureReason ?? existing.failureReason,
      updatedAt: Date.now(),
    })
    .where(eq(pipelineTasks.id, id))
    .run();
  return getPipelineTask(db, id);
}
