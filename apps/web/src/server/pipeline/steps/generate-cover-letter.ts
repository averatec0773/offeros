import { randomUUID } from "node:crypto";
import type { AgentTask, Artifact } from "@offeros/core";
import type { CoverLetterInput, CoverLetterOutput } from "@offeros/llm";
import type { PipelineContext } from "../types";
import { buildGroundingFacts } from "./grounding";

/**
 * Generates the cover letter grounded ONLY in the applicant's profile facts
 * plus the (tailored) résumé text, and the JD analysis summary. Persists as
 * the `cover-letter` artifact's v1. Gated by `shouldRun` (in steps/index.ts):
 * skipped when the requirement is `none` or the user skipped it.
 *
 * When the user has a default `cover-letter` template (Settings > Templates),
 * its `scaffoldHints` (salutation/closing/paragraph-count description) are
 * passed through as `templateHints`, which the task prepends to the prompt as
 * a labeled constraint block. With no default template, `templateHints` is
 * left `undefined` and the prompt is unchanged from before templates existed.
 */
export async function run(ctx: PipelineContext, task: AgentTask): Promise<void> {
  const application = ctx.repos.getApplication(task.applicationId);
  if (!application) throw new Error(`application ${task.applicationId} not found`);
  const profile = ctx.repos.getProfile();
  if (!profile) throw new Error("profile not found");

  const resumeArtifact = ctx.repos.getArtifact(ctx.taskId, "resume");
  const resumeText =
    resumeArtifact?.versions.find((v) => v.id === resumeArtifact.currentVersionId)?.content ?? "";
  const jdAnalysis = ctx.repos.getJdAnalysis(task.applicationId);
  const template = ctx.repos.getDefaultTemplate("cover-letter");

  const input: CoverLetterInput = {
    jobInfo: application.jobInfo,
    groundingFacts: buildGroundingFacts(profile, resumeText),
    jdSummary: jdAnalysis?.summary,
    templateHints: template?.scaffoldHints || undefined,
    styleNotes: ctx.repos.getStyleNotes("cover-letter") ?? undefined,
  };
  const output = (await ctx.runLlm("cover-letter", input)) as CoverLetterOutput;

  const now = Date.now();
  const existing = ctx.repos.getArtifact(ctx.taskId, "cover-letter");
  const versionId = randomUUID();
  const newVersion = {
    id: versionId,
    content: output.content,
    rationale: output.rationale,
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
        kind: "cover-letter",
        versions: [newVersion],
        currentVersionId: versionId,
        createdAt: now,
        updatedAt: now,
      };
  ctx.repos.upsertArtifact(artifact);
}
