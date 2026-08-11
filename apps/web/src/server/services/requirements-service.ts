import { classifyField, isCoverLetterLabel, matchAnswer } from "@offeros/autofill";
import type { Application, FieldReport, Profile } from "@offeros/core";
import type { Db } from "../db/client";
import { getApplication } from "../repositories/application-repo";
import { getPipelineTaskByApplicationId } from "../repositories/pipeline-task-by-application";
import { listEvents } from "../repositories/application-event-repo";
import { shapesFor, type StoredShape } from "../repositories/form-memory-repo";
import { listAnswers } from "../repositories/answer-repo";
import { getProfile } from "../repositories/profile-repo";
import type { ReconVerdict } from "./recon/types";

/**
 * What this application's form asks, and how ready the user is for it.
 *
 * Entirely deterministic — no model call anywhere in this file. Every number
 * is a lookup against the answer bank and the profile using the same matching
 * the fill engine itself uses, so the card cannot promise a readiness the fill
 * will not deliver.
 *
 * Two sources, in strict order of authority:
 *
 *   1. A real fill. The engine met the actual form and reported per field.
 *      Nothing beats having been there.
 *   2. A prescan. The platform's public API, read before applying. Cheaper and
 *      earlier, but it describes the form as advertised.
 *
 * With neither, the honest answer is "we have not looked yet" — not an
 * optimistic zero.
 */

export type RequirementsSource = "fill" | "prescan" | "none";

export interface RequirementsSummary {
  source: RequirementsSource;
  /** Every question the form is known to ask. */
  total: number;
  required: number;
  /** Required questions we already have an answer or profile value for. */
  ready: number;
  /** Required questions we do not — the actual to-do list, capped for display. */
  missing: string[];
  /** Long-form questions: the ones that cost real time to fill. */
  freeText: number;
  /** True when the form has a cover-letter field, so one is worth generating. */
  needsCoverLetter: boolean;
  /** The last reconnaissance, when there has been one. */
  lastChecked?: { at: number; verdict: ReconVerdict; detail: string };
  /** The posting's own freshness line, when the source gave us one. */
  publishTimeDesc?: string;
}

/** How many missing questions to name before the list stops being a to-do. */
const MISSING_SHOWN = 8;

/** One question, however we came to know about it. */
interface KnownQuestion {
  question: string;
  control: string;
  required: boolean;
}

/**
 * Does the user already have this answer?
 *
 * Two ways, both the fill engine's own: a saved answer whose patterns match
 * the question, or a profile field the classifier recognises and the profile
 * actually holds. Anything else counts as missing — an optimistic guess here
 * would be a promise the fill cannot keep.
 */
function isCovered(
  question: KnownQuestion,
  answers: ReturnType<typeof listAnswers>,
  profile: Profile | null,
): boolean {
  if (matchAnswer(question.question, answers)) return true;
  const canonical = classifyField({
    fieldId: "",
    label: question.question,
    name: "",
    autocomplete: "",
    type: question.control,
    placeholder: "",
    ariaLabel: "",
  });
  if (!canonical || !profile) return false;
  const personal = profile.personal as unknown as Record<string, unknown>;
  switch (canonical) {
    case "firstName":
    case "lastName":
    case "fullName":
      return typeof personal.name === "string" && personal.name.trim() !== "";
    case "email":
      return typeof personal.email === "string" && personal.email.trim() !== "";
    case "phone":
      return typeof personal.phone === "string" && personal.phone.trim() !== "";
    case "linkedin":
    case "github":
    case "portfolio": {
      const links = (personal.links ?? {}) as Record<string, unknown>;
      return typeof links[canonical] === "string" && String(links[canonical]).trim() !== "";
    }
    case "city":
    case "state":
    case "country":
    case "postalCode":
    case "address":
      return typeof personal[canonical] === "string" && String(personal[canonical]).trim() !== "";
    case "resume":
      // Attaching is its own flow with its own card; not a gap this card owns.
      return true;
    default:
      return false;
  }
}

/** Questions as the last real fill reported them. */
function fromFieldReports(reports: FieldReport[]): KnownQuestion[] {
  return reports
    .filter((r) => r.outcome !== "skipped")
    .map((r) => ({
      question: r.label || r.fieldId,
      control: r.classifiedType,
      required: r.required === true,
    }))
    .filter((q) => q.question.trim() !== "");
}

/** Questions a prescan learned, resolved from the keys it recorded. */
function fromPrescan(shapes: StoredShape[]): KnownQuestion[] {
  return shapes.map((s) => ({
    question: s.question,
    control: s.classifiedType,
    required: s.required,
  }));
}

/** The most recent reconnaissance recorded on this application, if any. */
function lastRecon(db: Db, applicationId: string) {
  const checks = listEvents(db, applicationId).filter((e) => e.kind === "job-checked");
  const latest = checks[checks.length - 1];
  if (!latest) return null;
  const payload = (latest.payload ?? {}) as {
    verdict?: unknown;
    detail?: unknown;
    questionKeys?: unknown;
  };
  return {
    at: latest.at,
    verdict: (typeof payload.verdict === "string" ? payload.verdict : "unknown") as ReconVerdict,
    detail: typeof payload.detail === "string" ? payload.detail : "",
    questionKeys: Array.isArray(payload.questionKeys)
      ? payload.questionKeys.filter((k): k is string => typeof k === "string")
      : [],
  };
}

export function buildRequirements(db: Db, applicationId: string): RequirementsSummary | null {
  const application: Application | null = getApplication(db, applicationId);
  if (!application) return null;

  const recon = lastRecon(db, applicationId);
  const task = getPipelineTaskByApplicationId(db, applicationId);
  const reports = task?.fieldReports ?? [];

  // A real fill wins outright. Only when there has never been one do we fall
  // back to what the platform advertised.
  let source: RequirementsSource = "none";
  let questions: KnownQuestion[] = [];
  if (reports.length > 0) {
    source = "fill";
    questions = fromFieldReports(reports);
  } else if (recon && recon.questionKeys.length > 0) {
    const shapes = shapesFor(db, recon.questionKeys);
    if (shapes.length > 0) {
      source = "prescan";
      questions = fromPrescan(shapes);
    }
  }

  const answers = listAnswers(db);
  const profile = getProfile(db);
  const required = questions.filter((q) => q.required);
  const missing = required.filter((q) => !isCovered(q, answers, profile));

  return {
    source,
    total: questions.length,
    required: required.length,
    ready: required.length - missing.length,
    missing: missing.map((q) => q.question).slice(0, MISSING_SHOWN),
    freeText: questions.filter((q) => q.control === "long-text" || q.control === "textarea").length,
    needsCoverLetter: questions.some((q) => isCoverLetterLabel(q.question)),
    ...(recon
      ? { lastChecked: { at: recon.at, verdict: recon.verdict, detail: recon.detail } }
      : {}),
    ...(application.jobInfo.publishTimeDesc
      ? { publishTimeDesc: application.jobInfo.publishTimeDesc }
      : {}),
  };
}
