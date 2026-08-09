/**
 * Answer guards: which questions an automated answer must not decide alone.
 *
 * These were regexes scattered in the panel until a real application form
 * showed why they belong in one tested place: the same question appears as a
 * radio group on one site and a textarea on the next, and a guard that only
 * covered one lane let a generated answer about visa sponsorship reach a live
 * application.
 *
 * Three classes, three different reasons — and three different handling rules:
 *
 *   sensitive   Voluntary self-identification (gender, race, veteran,
 *               disability, orientation, age). The user answers these once in
 *               Profile → Equal Employment; an automated guess is never
 *               appropriate. NOT auto-answered.
 *
 *   truth       Facts only the applicant can assert, with legal weight:
 *               work authorization, visa sponsorship. A wrong guess is a
 *               misrepresentation on a real application. NOT auto-answered;
 *               they fill from the user's own stored answer or not at all.
 *
 *   policy      Acknowledgments and consents — "I agree to the AI-use policy",
 *               "I consent to text messages". Observed live: a form asking the
 *               candidate to accept a policy that forbids AI tools during
 *               interviews. These MAY be filled (owner decision), because
 *               leaving them blank blocks submission, but the user is told
 *               afterwards exactly what was agreed to, with the wording, so
 *               the acceptance is theirs in fact and not only in form.
 */

export type GuardClass = "sensitive" | "truth" | "policy";

const SENSITIVE =
  /gender|race|ethnic|veteran|disab|orientation|lgbt|pronoun|hispanic|latino|transgender|immigrant|refugee|\bage\b/i;

const TRUTH =
  /sponsor|authoriz\w* to work|work authoriz|legally (?:able|authorized|eligible)|eligible to work|\bvisa\b/i;

// Acknowledgment shapes, not topics: "do you agree/acknowledge/consent…",
// "I have read…", "terms and conditions", "privacy policy", "code of conduct".
const POLICY =
  /\b(?:acknowledge|acknowledgement|acknowledgment|consent|agree to|agree that|accept the|i have read|terms (?:and|&) conditions|privacy policy|code of conduct|policy)\b/i;

export interface GuardSubject {
  /** The question as shown to the applicant. */
  label: string;
  /** A secondary label (descriptor label / aria) when the plan's differs. */
  altLabel?: string;
  /** Option labels — a neutral question can have sensitive OPTIONS
   *  ("Which communities do you belong to?" → disability, veteran…). */
  options?: string[];
}

/**
 * The guard class for a question, or null when it is an ordinary one.
 * Sensitive wins over truth wins over policy: a question that reads as several
 * gets the most restrictive handling.
 */
export function guardClassOf(subject: GuardSubject): GuardClass | null {
  const text = `${subject.label} ${subject.altLabel ?? ""}`;
  if (SENSITIVE.test(text) || (subject.options ?? []).some((o) => SENSITIVE.test(o))) {
    return "sensitive";
  }
  if (TRUTH.test(text)) return "truth";
  if (POLICY.test(text)) return "policy";
  return null;
}

/** True when no automated answer may decide this question. */
export function isAutoAnswerForbidden(subject: GuardSubject): boolean {
  const guard = guardClassOf(subject);
  return guard === "sensitive" || guard === "truth";
}

/** True when an answer is allowed but the user must review what it committed to. */
export function needsPostFillReview(subject: GuardSubject): boolean {
  return guardClassOf(subject) === "policy";
}
