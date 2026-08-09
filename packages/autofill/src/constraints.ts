/**
 * Dealbreaker screening: the constraints that decide an application is not
 * worth starting, read off the job's own text.
 *
 * These come from the answers the user already committed to — needing visa
 * sponsorship, not being able to relocate — checked against what the posting
 * says. A job that rules the applicant out is worth flagging BEFORE the
 * pipeline spends a tailoring call on it, and worth saying out loud rather
 * than silently skipping: postings lie, and the user may know better.
 *
 * Everything here is deterministic string work. A "conflict" is a claim about
 * the posting's wording, never a judgement about the person.
 */

export interface ApplicantConstraints {
  /** True when the applicant needs an employer to sponsor a work visa. */
  needsSponsorship?: boolean;
  /** Places the applicant can actually work from, in their own words. */
  locations?: string[];
  /** True when the applicant cannot relocate for a role. */
  remoteOnly?: boolean;
}

export type ConflictKind = "no-sponsorship" | "onsite-required";

export interface Conflict {
  kind: ConflictKind;
  /** What the posting says, quoted back so the user can judge it themselves. */
  evidence: string;
  /** Why this rules them out, in one line. */
  reason: string;
}

/** Sentences that say the employer will not sponsor. */
const NO_SPONSORSHIP =
  /(?:not|unable to|cannot|won['’]t|do not|does not)\s+(?:provide|offer|sponsor)[^.]{0,40}(?:sponsor|visa)|no visa sponsorship|without sponsorship|sponsorship is not (?:available|offered|provided)/i;

/** Sentences that require presence in an office. */
const ONSITE_REQUIRED =
  /(?:required|must be|expected)[^.]{0,40}(?:on[- ]?site|in[- ]?office|in the office)|this (?:is|role is) (?:a )?(?:fully )?on[- ]?site|no remote|not (?:a )?remote/i;

/** The first sentence containing `match`, trimmed for display. */
function quote(text: string, pattern: RegExp): string {
  const sentence = text.split(/(?<=[.!?])\s+/).find((s) => pattern.test(s));
  const cleaned = (sentence ?? "").replace(/\s+/g, " ").trim();
  return cleaned.length > 160 ? `${cleaned.slice(0, 157)}…` : cleaned;
}

/**
 * Constraints this posting conflicts with. Empty means nothing in the text
 * rules the applicant out — NOT that the job is a good fit, which is a
 * separate question the fit score answers.
 */
export function findConflicts(jobText: string, constraints: ApplicantConstraints): Conflict[] {
  const out: Conflict[] = [];
  if (!jobText.trim()) return out;

  if (constraints.needsSponsorship && NO_SPONSORSHIP.test(jobText)) {
    out.push({
      kind: "no-sponsorship",
      evidence: quote(jobText, NO_SPONSORSHIP),
      reason: "You need sponsorship and this posting says it isn't offered.",
    });
  }
  if (constraints.remoteOnly && ONSITE_REQUIRED.test(jobText)) {
    out.push({
      kind: "onsite-required",
      evidence: quote(jobText, ONSITE_REQUIRED),
      reason: "You're remote-only and this role is described as on-site.",
    });
  }
  return out;
}
