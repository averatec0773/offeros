import { isCoverLetterLabel } from "@offeros/autofill";
import type { Application } from "@offeros/core";
import type { Db } from "../db/client";
import { getApplication } from "../repositories/application-repo";
import { listEvents } from "../repositories/application-event-repo";
import { buildCoverage } from "./question-coverage-service";
import type { ReconVerdict } from "./recon/types";

/**
 * What this application's form asks, and how ready the user is for it.
 *
 * ONE VIEW of the question-coverage read model, narrowed to a single
 * application — not a second implementation of it. The questions, the
 * deduplication and the answered/unanswered/not-ours decision all come from
 * `buildCoverage`, so this card and the cross-application gaps list can never
 * drift into disagreeing about the same question.
 *
 * What stays here is the part that is genuinely about ONE application: which
 * source got to speak (a real fill outranks a prescan), the recon verdict, the
 * posting's freshness, and the shape of the summary this particular card
 * renders.
 *
 * Entirely deterministic — no model call anywhere in this file or below it.
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
  const questions = buildCoverage(db, { applicationId });

  // Which source got to speak. A real fill outranks a prescan — it met the form
  // rather than its advertisement — and the read model records what each
  // sighting came from, so this reads the answer instead of recomputing it.
  const source: RequirementsSource = questions.some((q) => q.origins.includes("fill"))
    ? "fill"
    : questions.some((q) => q.origins.includes("prescan"))
      ? "prescan"
      : "none";

  const required = questions.filter((q) => q.required);
  // Anything without an answer is still work left on THIS application,
  // including the ones OfferOS will not answer for the user — those they have
  // to type themselves, which is more work rather than less. The gaps list
  // separates the two because its question is different ("what is worth
  // answering once"); readiness here is simply "is this form ready to send".
  const missing = required.filter((q) => q.state !== "answered");

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
