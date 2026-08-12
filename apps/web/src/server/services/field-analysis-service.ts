import { isAutoAnswerForbidden, guardClassOf, matchAnswer } from "@offeros/autofill";
import type { AnalyzeFieldInput, AnalyzeSources, FieldAnalysis } from "@offeros/llm";
import type { Db } from "../db/client";
import { getApplication } from "../repositories/application-repo";
import { getProfile } from "../repositories/profile-repo";
import { listAnswers } from "../repositories/answer-repo";
import { getResumeText, listResumes } from "./resume-service";
import { resolveEffectiveResume } from "../pipeline/steps/grounding";

/**
 * Answering the fields the engine could not, from the applicant's own material.
 *
 * The lane this replaces asked a model, one field at a time, "which canonical
 * field name is this?" and showed it nothing about the applicant. That is a
 * useful question for `Telefonnummer` and a useless one for "Which of your
 * projects is most relevant to this role?" — answering the second requires
 * having read the résumé and the posting. On a real application it placed 8 of
 * 72 fields, which was the honest ceiling of the question it was asked.
 *
 * The material is what the agent's read tools already expose, so this reads it
 * the same way they do, from the same records. What arrives at the model is the
 * structured profile, the résumé text, the job description, and the answers the
 * applicant has given before — everything a person would need to fill the form
 * by hand.
 *
 * Two things keep capability from becoming fabrication, and neither is a
 * request to the model:
 *
 *   1. every value must quote the material it came from, and the quote is
 *      checked against that material HERE. A value whose evidence is not
 *      actually in the source it names is discarded. Prompts that say "do not
 *      invent" are hope; this is arithmetic.
 *   2. the questions only the applicant can answer are refused on the field's
 *      own text, before anything the model said is looked at.
 */

/** How much of each source the model is given. Generous — the point is sight. */
const PROFILE_BUDGET = 6000;
const RESUME_BUDGET = 12000;
const JD_BUDGET = 12000;
const ANSWER_BUDGET = 60;

/** Which fields are worth spending a call on. */
export function eligibleForAnalysis(f: { currentValue?: string }): boolean {
  // A field the page already holds a value for is not outstanding — filling it
  // again would overwrite whatever the applicant or an earlier run put there.
  return (f.currentValue ?? "").trim() === "";
}

/** The applicant's structured background, as text the model can read. */
function profileText(db: Db): string {
  const profile = getProfile(db);
  if (!profile) return "";
  const p = profile.personal;
  const lines: string[] = [];
  const personal = Object.entries(p)
    .filter(([k, v]) => k !== "links" && typeof v === "string" && v.trim() !== "")
    .map(([k, v]) => `${k}: ${String(v)}`);
  if (personal.length > 0) lines.push("Personal:", ...personal.map((l) => `  ${l}`));
  const links = Object.entries(p.links ?? {})
    .filter(([, v]) => typeof v === "string" && v.trim() !== "")
    .map(([k, v]) => `  ${k}: ${String(v)}`);
  if (links.length > 0) lines.push("Links:", ...links);
  if (profile.skills.length > 0) lines.push(`Skills: ${profile.skills.join(", ")}`);
  if (profile.experience.length > 0) {
    lines.push("Work history (most recent first):");
    profile.experience.forEach((e, i) => {
      lines.push(`  [${i}] ${e.title} at ${e.company} (${e.start}–${e.end})`);
      for (const b of e.bullets ?? []) lines.push(`      - ${b}`);
    });
  }
  if (profile.education.length > 0) {
    lines.push("Education (most recent first):");
    profile.education.forEach((e, i) => {
      lines.push(`  [${i}] ${e.degree} in ${e.field}, ${e.school} (${e.start}–${e.end})`);
    });
  }
  return lines.join("\n").slice(0, PROFILE_BUDGET);
}

/**
 * Everything the model gets to look at.
 *
 * Read once, before the call, rather than fetched turn by turn: the four reads
 * are deterministic and a conversation about which to make next would spend
 * budget without seeing anything more.
 */
export async function gatherSources(db: Db, applicationId: string): Promise<AnalyzeSources> {
  const application = getApplication(db, applicationId);
  const resume = resolveEffectiveResume({ resumeId: application?.resumeId }, listResumes(db));
  const resumeText = resume ? (await getResumeText(db, resume.id)).trim() : "";
  return {
    profile: profileText(db),
    resume: resumeText.slice(0, RESUME_BUDGET),
    jobDescription: (application?.jdText ?? "").trim().slice(0, JD_BUDGET),
    savedAnswers: listAnswers(db)
      .slice(0, ANSWER_BUDGET)
      .map((a) => ({ question: a.questionPatterns[0] ?? "", answer: a.answer }))
      .filter((a) => a.question !== "" && a.answer.trim() !== ""),
  };
}

/** What the panel receives for one field. */
export interface AnalyzedField {
  fieldId: string;
  value: string | null;
  source: "agent";
  reason: string;
  /** True when this is the applicant's to answer and no value was produced. */
  needsUser?: true;
}

/** Loose comparison for "is this quote actually in that text". */
function squash(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

/**
 * Is this answer actually supported by the material it claims?
 *
 * The evidence must appear in the source named. Compared loosely on
 * whitespace and punctuation — a model that reflows a quote is still quoting —
 * but not loosely on words, because the words are the whole check.
 *
 * Short evidence is not evidence: a three-character quote appears in anything,
 * so it cannot distinguish a real answer from an invented one.
 */
const MIN_EVIDENCE_CHARS = 12;

export function evidenceHolds(analysis: FieldAnalysis, sources: AnalyzeSources): boolean {
  if (analysis.value === null) return true;
  const evidence = (analysis.evidence ?? "").trim();
  if (evidence.length < MIN_EVIDENCE_CHARS) return false;
  const haystack =
    analysis.from === "resume"
      ? sources.resume
      : analysis.from === "job-description"
        ? sources.jobDescription
        : analysis.from === "saved-answers"
          ? sources.savedAnswers.map((a) => `${a.question} ${a.answer}`).join("\n")
          : analysis.from === "profile"
            ? sources.profile
            : "";
  if (haystack === "") return false;
  return squash(haystack).includes(squash(evidence));
}

/**
 * Turn what the model said into what the panel may act on.
 *
 * `fields` is the same snapshot that was sent, because the guards read a
 * field's own label and options — not the model's opinion of it.
 */
export function resolveAnalyses(
  analyses: FieldAnalysis[],
  fields: AnalyzeFieldInput[],
  sources: AnalyzeSources,
): AnalyzedField[] {
  // Iterate over what was SENT, not over what came back.
  //
  // A model that omits a field would otherwise make it vanish: the applicant
  // is told nothing about it, and a guarded question silently loses its "this
  // one is yours" note. Every field asked about gets an answer, and silence is
  // one of the answers.
  const byId = new Map(analyses.map((a) => [a.fieldId, a]));

  return fields.map((field): AnalyzedField => {
    const subject = { label: field.label, options: field.options };
    if (isAutoAnswerForbidden(subject)) {
      const guard = guardClassOf(subject);
      return {
        fieldId: field.fieldId,
        value: null,
        source: "agent",
        needsUser: true,
        reason:
          guard === "sensitive"
            ? "Self-identification is yours to answer — set it once in Profile → Equal Employment."
            : "This is a legal statement only you can make.",
      };
    }

    const analysis = byId.get(field.fieldId);
    if (!analysis) {
      return {
        fieldId: field.fieldId,
        value: null,
        source: "agent",
        needsUser: true,
        reason: "No answer came back for this one — it is yours to fill in.",
      };
    }

    if (analysis.value === null || analysis.value.trim() === "") {
      return {
        fieldId: field.fieldId,
        value: null,
        source: "agent",
        needsUser: true,
        reason: analysis.reason.trim() || "Nothing in your profile or résumé answers this.",
      };
    }

    // An answer that cannot point at the words it came from is thrown away.
    if (!evidenceHolds(analysis, sources)) {
      return {
        fieldId: field.fieldId,
        value: null,
        source: "agent",
        needsUser: true,
        reason:
          "Couldn't trace an answer for this back to your profile or résumé, so it is yours to fill in.",
      };
    }

    // A multiple-choice answer has to be one of the page's own options.
    if (field.options?.length && !field.options.includes(analysis.value)) {
      return {
        fieldId: field.fieldId,
        value: null,
        source: "agent",
        needsUser: true,
        reason: "None of this field's options matched what your material says.",
      };
    }

    return {
      fieldId: field.fieldId,
      value: analysis.value,
      source: "agent",
      reason: analysis.reason.trim() || whereFrom(analysis),
    };
  });
}

function whereFrom(analysis: FieldAnalysis): string {
  const label: Record<string, string> = {
    profile: "from your profile",
    resume: "from your résumé",
    "job-description": "from the job description",
    "saved-answers": "from an answer you saved before",
  };
  return label[analysis.from ?? ""] ?? "from your own records";
}

/** A saved answer for this question, when there is one — cheaper than a call. */
export function savedAnswerFor(db: Db, label: string): string | null {
  const hit = matchAnswer(label, listAnswers(db));
  return hit && hit.answer.trim() !== "" ? hit.answer : null;
}
