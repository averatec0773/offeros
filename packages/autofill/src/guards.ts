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

// Legal work status in the wordings forms actually use — citizenship and
// residency belong here as much as sponsorship: they are the same kind of
// fact (only the applicant can assert it, and being wrong is a
// misrepresentation), and leaving them out let a generated answer decide one.
const TRUTH =
  /sponsor|\bvisa\b|\bh-?1b\b|immigration|citizen|permanent resident|green card|(?:work|employment)\s+(?:authoriz|eligib)|authoriz\w*\s+to\s+work|legally\s+(?:able|authorized|eligible)|eligib\w*\s+(?:to|for)\s+work/i;

// Acknowledgment SHAPES, not topics. A bare "policy" would sweep in ordinary
// questions ("describe a time you challenged a company policy") and bury the
// real consents in the one surface meant to catch them — so the named
// documents are listed explicitly, and agree/consent needs an acknowledgment
// frame around it.
const POLICY =
  /\b(?:acknowledge|acknowledgement|acknowledgment)\b|\bi (?:have read|agree|accept|consent)\b|\bby (?:submitting|applying|checking)\b|\b(?:do you )?consent to\b|\bterms (?:and|&) conditions\b|\bprivacy policy\b|\bcode of conduct\b|\b(?:ai|acceptable) use policy\b/i;

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
  // One haystack for every class. Real forms put the substance in the OPTIONS
  // as often as the label — a group labelled "Please select one" whose choices
  // are "…will not require visa sponsorship" / "…will require sponsorship" is
  // a work-authorization question, and testing only the label let one be
  // answered for the applicant.
  const text = [subject.label, subject.altLabel ?? "", ...(subject.options ?? [])].join(" ");
  if (SENSITIVE.test(text)) return "sensitive";
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
