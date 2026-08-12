import type { PipelineTask } from "@offeros/core";
import type { PipelineContext } from "../types";
import { analyzeJd } from "../../services/jd-analysis-service";
import { computeFit } from "../../services/fit-service";

/**
 * Analyzes the job description against the applicant's profile, persists the
 * result (incl. matchNotes/gaps), and sets the task's `coverLetterRequirement`
 * from the analysis so the generate-cover-letter gate can branch on it.
 */
export async function run(ctx: PipelineContext, task: PipelineTask): Promise<void> {
  const application = ctx.repos.getApplication(task.applicationId);
  if (!application) throw new Error(`application ${task.applicationId} not found`);
  const profile = ctx.repos.getProfile();
  if (!profile) throw new Error("profile not found");

  // One definition of "an analysis" — the application page's own AI-read
  // button runs the same service, so the two cannot drift.
  const analysis = await analyzeJd(ctx.db, task.applicationId, { runLlm: ctx.runLlm });
  await ctx.repos.updatePipelineTask(ctx.taskId, {
    coverLetterRequirement: analysis.coverLetterRequirement,
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
