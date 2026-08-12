import { randomUUID } from "node:crypto";
import type { JdAnalysis } from "@offeros/core";
import { jdFactHints, type JdAnalysisInput, type JdAnalysisOutput } from "@offeros/llm";
import type { Db } from "../db/client";
import { getApplication } from "../repositories/application-repo";
import { getJdAnalysis, saveJdAnalysis } from "../repositories/jd-analysis-repo";
import { getProfile } from "../repositories/profile-repo";
import { appendEvent } from "../repositories/application-event-repo";
import { buildProfileFacts } from "../pipeline/steps/grounding";

/**
 * Read one job description with the model, and keep the result.
 *
 * Extracted from the analyze-site pipeline step so the application page can
 * offer it as a single deliberate act — one button, one call, paid for with
 * the user's own key — without dragging the rest of the step along. The step
 * still calls this, so there is one implementation of "what an analysis is and
 * where it is stored", not two that can drift.
 *
 * The JD text reaches the model through the task's own `buildUserPrompt`,
 * which fences it as untrusted page text. Nothing here goes around that.
 */

export interface AnalyzeJdDeps {
  runLlm: (taskId: string, input: unknown) => Promise<unknown>;
}

export class JdAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JdAnalysisError";
  }
}

/**
 * Analyse this application's job description and store the result.
 *
 * Re-running replaces the stored reading in place (same row id and created-at),
 * because there is one current understanding of a posting, not a history of
 * readings — the artifact versions are where revision history belongs.
 */
export async function analyzeJd(
  db: Db,
  applicationId: string,
  deps: AnalyzeJdDeps,
  /** A viewpoint the user typed, carried into the prompt and stored with the
   *  result so the page can say which lens produced what it is showing. */
  instruction?: string,
): Promise<JdAnalysis> {
  const application = getApplication(db, applicationId);
  if (!application) throw new JdAnalysisError(`application ${applicationId} not found`);
  const jdText = application.jdText?.trim() ?? "";
  if (jdText === "") {
    throw new JdAnalysisError("there is no job description to read yet");
  }
  const profile = getProfile(db);

  const hints = jdFactHints(jdText);
  const asked = instruction?.trim() ?? "";
  const input: JdAnalysisInput = {
    jdText,
    jobInfo: application.jobInfo,
    profileSummary: profile ? buildProfileFacts(profile) : "",
    ...(asked ? { instruction: asked } : {}),
    ...(hints ? { factHints: hints } : {}),
  };
  const output = (await deps.runLlm("jd-analysis", input)) as JdAnalysisOutput;

  const existing = getJdAnalysis(db, applicationId);
  const analysis: JdAnalysis = {
    id: existing?.id ?? randomUUID(),
    applicationId,
    summary: output.summary,
    responsibilities: output.responsibilities,
    requiredSkills: output.requiredSkills,
    preferredSkills: output.preferredSkills,
    matchNotes: output.matchNotes,
    gaps: output.gaps,
    coverLetterRequirement: output.coverLetterRequirement,
    jobFacts: output.jobFacts,
    // Stored with the result: a reading done through a lens is not the same
    // reading as one done straight, and the page should be able to say so.
    ...(asked ? { instruction: asked } : {}),
    createdAt: existing?.createdAt ?? Date.now(),
  };
  saveJdAnalysis(db, analysis);
  appendEvent(db, {
    applicationId,
    kind: "jd-analyzed",
    payload: { requiredSkills: analysis.requiredSkills.length, gaps: analysis.gaps.length },
  });
  return analysis;
}
