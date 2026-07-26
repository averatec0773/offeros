import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { agentTaskSchema, type AgentTask } from "@offeros/core";
import type { Db } from "../db/client";
import { agentTasks } from "../db/schema";

type Row = typeof agentTasks.$inferSelect;

export function toDomain(row: Row): AgentTask {
  return agentTaskSchema.parse({
    id: row.id,
    applicationId: row.applicationId,
    status: row.status,
    step: row.step,
    applicationInfo: row.applicationInfo ?? undefined,
    resumeId: row.resumeId ?? undefined,
    coverLetterId: row.coverLetterId ?? undefined,
    coverLetterRequirement: row.coverLetterRequirement,
    skippedCoverLetter: row.skippedCoverLetter,
    fieldReports: row.fieldReports ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function listAgentTasks(db: Db): AgentTask[] {
  return db.select().from(agentTasks).orderBy(desc(agentTasks.updatedAt)).all().map(toDomain);
}

export function getAgentTask(db: Db, id: string): AgentTask | null {
  const row = db.select().from(agentTasks).where(eq(agentTasks.id, id)).get();
  return row ? toDomain(row) : null;
}

export function createAgentTask(db: Db, input: { applicationId: string }): AgentTask {
  const now = Date.now();
  const row = {
    id: randomUUID(),
    applicationId: input.applicationId,
    status: "queued",
    step: 0,
    applicationInfo: null,
    resumeId: null,
    coverLetterId: null,
    coverLetterRequirement: "unknown",
    skippedCoverLetter: false,
    fieldReports: null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(agentTasks).values(row).run();
  return toDomain(row as Row);
}

export function updateAgentTask(
  db: Db,
  id: string,
  patch: Partial<
    Pick<
      AgentTask,
      | "status"
      | "step"
      | "applicationInfo"
      | "resumeId"
      | "coverLetterId"
      | "coverLetterRequirement"
      | "skippedCoverLetter"
      | "fieldReports"
    >
  >,
): AgentTask | null {
  const existing = db.select().from(agentTasks).where(eq(agentTasks.id, id)).get();
  if (!existing) return null;
  db.update(agentTasks)
    .set({
      status: patch.status ?? existing.status,
      step: patch.step ?? existing.step,
      applicationInfo: patch.applicationInfo ?? existing.applicationInfo,
      resumeId: patch.resumeId ?? existing.resumeId,
      coverLetterId: patch.coverLetterId ?? existing.coverLetterId,
      coverLetterRequirement: patch.coverLetterRequirement ?? existing.coverLetterRequirement,
      skippedCoverLetter: patch.skippedCoverLetter ?? existing.skippedCoverLetter,
      fieldReports: patch.fieldReports ?? existing.fieldReports,
      updatedAt: Date.now(),
    })
    .where(eq(agentTasks.id, id))
    .run();
  return getAgentTask(db, id);
}
