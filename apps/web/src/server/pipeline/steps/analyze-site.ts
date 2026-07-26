import { randomUUID } from "node:crypto";
import type { AgentTask, JdAnalysis } from "@offeros/core";
import type { JdAnalysisInput, JdAnalysisOutput } from "@offeros/llm";
import type { PipelineContext } from "../types";
import { buildProfileFacts } from "./grounding";
import { computeFit } from "../../services/fit-service";

/**
 * Analyzes the job description against the applicant's profile, persists the
 * result (incl. matchNotes/gaps), and sets the task's `coverLetterRequirement`
 * from the analysis so the generate-cover-letter gate can branch on it.
 */
export async function run(ctx: PipelineContext, task: AgentTask): Promise<void> {
  const application = ctx.repos.getApplication(task.applicationId);
  if (!application) throw new Error(`application ${task.applicationId} not found`);
  const profile = ctx.repos.getProfile();
  if (!profile) throw new Error("profile not found");

  const input: JdAnalysisInput = {
    jdText: application.jdText ?? "",
    jobInfo: application.jobInfo,
    profileSummary: buildProfileFacts(profile),
  };
  const output = (await ctx.runLlm("jd-analysis", input)) as JdAnalysisOutput;

  const existing = ctx.repos.getJdAnalysis(task.applicationId);
  const analysis: JdAnalysis = {
    id: existing?.id ?? randomUUID(),
    applicationId: task.applicationId,
    summary: output.summary,
    responsibilities: output.responsibilities,
    requiredSkills: output.requiredSkills,
    preferredSkills: output.preferredSkills,
    matchNotes: output.matchNotes,
    gaps: output.gaps,
    coverLetterRequirement: output.coverLetterRequirement,
    createdAt: existing?.createdAt ?? Date.now(),
  };
  ctx.repos.saveJdAnalysis(analysis);
  await ctx.repos.updateAgentTask(ctx.taskId, {
    coverLetterRequirement: output.coverLetterRequirement,
  });

  // Fit scoring is advisory: it must never affect the step's observable outcome.
  // A fit failure (LLM error, missing data) is swallowed so the pipeline lands
  // exactly as it would without this hook.
  try {
    await computeFit(ctx.db, task.applicationId, { runLlm: ctx.runLlm });
  } catch (error) {
    console.warn(
      `[analyze-site] fit computation failed for application ${task.applicationId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}
