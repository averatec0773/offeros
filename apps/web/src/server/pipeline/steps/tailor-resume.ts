import { randomUUID } from "node:crypto";
import { serializeResume, type AgentTask, type Artifact } from "@offeros/core";
import type { ResumeTailorInput, ResumeTailorOutput } from "@offeros/llm";
import type { PipelineContext } from "../types";
import { buildResumeHeader, resolveResumeText } from "./grounding";

/**
 * Tailors the applicant's résumé toward the job description and persists it
 * as a new `resume` artifact version (v1, or appended if one already exists).
 * Grounds the tailor on the application's selected résumé (falling back to
 * the primary, then to profile facts) via `resolveResumeText`.
 */
export async function run(ctx: PipelineContext, task: AgentTask): Promise<void> {
  const application = ctx.repos.getApplication(task.applicationId);
  if (!application) throw new Error(`application ${task.applicationId} not found`);
  const profile = ctx.repos.getProfile();
  if (!profile) throw new Error("profile not found");
  const resumes = ctx.repos.listResumes();

  const input: ResumeTailorInput = {
    resumeText: resolveResumeText(application, resumes, profile),
    jobInfo: application.jobInfo,
    jdText: application.jdText ?? "",
  };
  const output = (await ctx.runLlm("resume-tailor", input)) as ResumeTailorOutput;
  const content = serializeResume(output.structured, buildResumeHeader(profile));

  const now = Date.now();
  const existing = ctx.repos.getArtifact(ctx.taskId, "resume");
  const versionId = randomUUID();
  const newVersion = {
    id: versionId,
    content,
    rationale: output.rationale,
    changedLines: output.changedLines,
    resumeData: output.structured,
    createdAt: now,
  };
  const artifact: Artifact = existing
    ? {
        ...existing,
        versions: [...existing.versions, newVersion],
        currentVersionId: versionId,
        updatedAt: now,
      }
    : {
        id: randomUUID(),
        taskId: ctx.taskId,
        kind: "resume",
        versions: [newVersion],
        currentVersionId: versionId,
        createdAt: now,
        updatedAt: now,
      };
  ctx.repos.upsertArtifact(artifact);
}
