import { randomUUID } from "node:crypto";
import {
  serializeResume,
  type Artifact,
  type ArtifactVersion,
  type StructuredResume,
} from "@offeros/core";
import type {
  CoverLetterInput,
  CoverLetterOutput,
  ResumeTailorInput,
  ResumeTailorOutput,
} from "@offeros/llm";
import { diffLines, type LineDiff } from "@/lib/diff";
import type { PipelineContext } from "./types";
import { buildGroundingFacts, buildResumeHeader, resolveResumeText } from "./steps/grounding";

export type TweakArtifactKind = "resume" | "cover-letter";

/**
 * Regenerates one artifact (resume or cover letter) from a free-text
 * instruction: assembles the same grounding inputs the generation steps use,
 * plus `instruction` + `previousContent` so the LLM revises rather than
 * starts over, then appends a new version (preserving history, same as
 * Task 5's steps) and returns it alongside a line diff vs. the prior version.
 */
export async function tweakArtifact(
  ctx: PipelineContext,
  kind: TweakArtifactKind,
  instruction: string,
): Promise<{ version: ArtifactVersion; diff: LineDiff }> {
  const task = ctx.repos.getAgentTask(ctx.taskId);
  if (!task) throw new Error(`agent task ${ctx.taskId} not found`);
  const application = ctx.repos.getApplication(task.applicationId);
  if (!application) throw new Error(`application ${task.applicationId} not found`);
  const profile = ctx.repos.getProfile();
  if (!profile) throw new Error("profile not found");

  const existing = ctx.repos.getArtifact(ctx.taskId, kind);
  if (!existing) throw new Error(`no ${kind} artifact for task ${ctx.taskId}`);
  const currentVersion = existing.versions.find((v) => v.id === existing.currentVersionId);
  if (!currentVersion) throw new Error(`current version missing for ${kind} artifact`);
  const previousContent = currentVersion.content;

  let content: string;
  let rationale: string;
  let changedLines: string[] | undefined;
  let resumeData: StructuredResume | undefined;

  if (kind === "cover-letter") {
    const resumeArtifact = ctx.repos.getArtifact(ctx.taskId, "resume");
    const resumeText =
      resumeArtifact?.versions.find((v) => v.id === resumeArtifact.currentVersionId)?.content ?? "";
    const jdAnalysis = ctx.repos.getJdAnalysis(task.applicationId);
    const input: CoverLetterInput = {
      jobInfo: application.jobInfo,
      groundingFacts: buildGroundingFacts(profile, resumeText),
      jdSummary: jdAnalysis?.summary,
      instruction,
      previousContent,
    };
    const output = (await ctx.runLlm("cover-letter", input)) as CoverLetterOutput;
    content = output.content;
    rationale = output.rationale;
  } else {
    const resumes = ctx.repos.listResumes();
    const input: ResumeTailorInput = {
      resumeText: resolveResumeText(application, resumes, profile),
      jobInfo: application.jobInfo,
      jdText: application.jdText ?? "",
      instruction,
      previousContent,
    };
    const output = (await ctx.runLlm("resume-tailor", input)) as ResumeTailorOutput;
    content = serializeResume(output.structured, buildResumeHeader(profile));
    rationale = output.rationale;
    changedLines = output.changedLines;
    resumeData = output.structured;
  }

  const now = Date.now();
  const versionId = randomUUID();
  const newVersion: ArtifactVersion = {
    id: versionId,
    content,
    rationale,
    changedLines,
    resumeData,
    createdAt: now,
  };
  const updated: Artifact = {
    ...existing,
    versions: [...existing.versions, newVersion],
    currentVersionId: versionId,
    updatedAt: now,
  };
  ctx.repos.upsertArtifact(updated);

  return { version: newVersion, diff: diffLines(previousContent, content) };
}
