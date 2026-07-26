import { randomUUID } from "node:crypto";
import { fitAnalysisSchema, type Artifact, type FitAnalysis, type JdAnalysis } from "@offeros/core";
import type { FitAnalysisInput, FitAnalysisOutput } from "@offeros/llm";
import { pickSkillMatch, skillCandidates } from "@offeros/autofill";
import type { Db } from "../db/client";
import { getApplication } from "../repositories/application-repo";
import { getProfile } from "../repositories/profile-repo";
import { getJdAnalysis } from "../repositories/jd-analysis-repo";
import { getArtifact } from "../repositories/artifact-repo";
import { getAgentTaskByApplicationId } from "../repositories/agent-task-by-application";
import { getFit, saveFit } from "../repositories/fit-repo";
import { buildProfileFacts } from "../pipeline/steps/grounding";

/** Runs the LLM task; wired the same way pipeline steps / answer routes are. */
export interface ComputeFitDeps {
  runLlm: (taskId: string, input: unknown) => Promise<unknown>;
}

function currentResumeContent(artifact: Artifact | null): string | null {
  if (!artifact) return null;
  const version = artifact.versions.find((v) => v.id === artifact.currentVersionId);
  return version?.content ?? null;
}

/**
 * Deterministic skill overlap between the applicant's profile skills and the
 * JD's skill lists, computed with the same tolerant matcher the ATS autofill
 * uses (alias- and qualifier-aware, symmetric expansion on both sides).
 *
 * Weighting (kept simple and honest):
 * - `matched` = every JD skill (required OR preferred) the profile can back —
 *   crediting a met preferred skill as a genuine strength.
 * - `missing` = JD *required* skills with no profile match. Unmet *preferred*
 *   skills are NOT counted as gaps: they are nice-to-haves, not requirements,
 *   so treating their absence as a miss would overstate the gap.
 */
export function computeSkillOverlap(
  profileSkills: string[],
  jdAnalysis: JdAnalysis | null,
): { matched: string[]; missing: string[] } {
  const required = jdAnalysis?.requiredSkills ?? [];
  const preferred = jdAnalysis?.preferredSkills ?? [];
  const profileCandidates = profileSkills.flatMap(skillCandidates);
  const profileHas = (jdSkill: string): boolean =>
    pickSkillMatch(profileCandidates, skillCandidates(jdSkill)) !== null;

  const matched: string[] = [];
  for (const skill of [...required, ...preferred]) {
    if (profileHas(skill) && !matched.includes(skill)) matched.push(skill);
  }
  const missing = required.filter((skill) => !profileHas(skill));
  return { matched, missing };
}

/**
 * Compute the applicant↔job fit for one application and persist it (one row per
 * application, replaced on recompute). Loads the profile facts (reusing the
 * pipeline's grounding builder), the application's current tailored résumé
 * artifact text (falling back to profile facts when no résumé exists yet), the
 * raw JD text, and the stored jd-analysis for the deterministic skill overlap;
 * then runs the `fit-analysis` LLM task via the injected provider wiring,
 * validates the narrative output onto a persistable record, and upserts it.
 */
export async function computeFit(
  db: Db,
  applicationId: string,
  deps: ComputeFitDeps,
): Promise<FitAnalysis> {
  const application = getApplication(db, applicationId);
  if (!application) throw new Error(`application ${applicationId} not found`);

  const profile = getProfile(db);
  const profileSummary = profile ? buildProfileFacts(profile) : "";

  const task = getAgentTaskByApplicationId(db, applicationId);
  const resumeArtifact = task ? getArtifact(db, task.id, "resume") : null;
  const resumeText = currentResumeContent(resumeArtifact) ?? profileSummary;

  const jdAnalysis = getJdAnalysis(db, applicationId);
  const skillOverlap = computeSkillOverlap(profile?.skills ?? [], jdAnalysis);

  const input: FitAnalysisInput = {
    profileSummary,
    resumeText,
    jdText: application.jdText ?? "",
    skillOverlap,
  };
  const output = (await deps.runLlm("fit-analysis", input)) as FitAnalysisOutput;

  const existing = getFit(db, applicationId);
  const now = Date.now();
  const fit = fitAnalysisSchema.parse({
    id: existing?.id ?? randomUUID(),
    applicationId,
    version: 1,
    overall: output.overall,
    label: output.label,
    subScores: output.subScores,
    whyMatch: output.whyMatch,
    alignedSkills: output.alignedSkills,
    notAlignedSkills: output.notAlignedSkills,
    createdAt: existing?.createdAt ?? now,
  });
  return saveFit(db, fit);
}
