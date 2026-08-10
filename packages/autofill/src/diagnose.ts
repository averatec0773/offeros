/**
 * Why a fill did not finish, grouped by cause.
 *
 * The fill engine already writes, per field, what it classified, what it chose,
 * and a plain-language reason. What it does not do is say that eighteen failed
 * fields are four problems — and that is what a person needs, because eighteen
 * red rows is a wall, while "four of these are one missing answer" is a to-do
 * list.
 *
 * Doing the grouping here rather than in a prompt is the same call this project
 * makes everywhere: the deterministic part stays deterministic. The reason
 * strings are written by our own engine, so classifying them is a lookup, not a
 * judgement — and a lookup is testable, free, and identical every time. What is
 * left for a model is the part that genuinely needs judgement: which of these
 * causes matters to this user right now, and how to say it.
 */

/** The minimum a report row needs for this to work on it. */
export interface DiagnosableField {
  label: string;
  outcome: string;
  reason: string;
  source: string;
  required: boolean;
}

/**
 * Why a group of fields did not fill.
 *
 * The vocabulary is deliberately about WHO can fix it, not about what the code
 * did — that is the distinction the user is actually making when they look at a
 * failed fill.
 */
export type FailureCause =
  /** The engine understood the question and has no answer for it. The user
   *  answers once and the answer bank remembers. */
  | "needs-your-answer"
  /** The engine did not recognise the field at all. Nobody can act on this but
   *  a developer; for the user it means "fill this one by hand". */
  | "not-recognised"
  /** A file the browser will not let anything but a person choose. Working as
   *  intended, and worth saying so rather than listing as a failure. */
  | "manual-upload"
  /** A guard refused to answer on the user's behalf — work authorisation,
   *  sponsorship, demographics. Refusal is the feature. */
  | "only-you-can-answer"
  /** A value was chosen and written, and the page did not take it. This is the
   *  one that means something is broken. */
  | "write-rejected";

export interface CauseGroup {
  cause: FailureCause;
  /** One line the UI or an agent can use verbatim. */
  explanation: string;
  /**
   * How many fields share this cause. Separate from `fields` because that list
   * is capped for readability — reading its length as the count under-reports,
   * silently, exactly the way this module warns against elsewhere. Real data
   * caught it: eighteen unrecognised fields were reported as eight.
   */
  count: number;
  /** Up to NAMES_PER_CAUSE names, for showing. Not for counting. */
  fields: string[];
  requiredCount: number;
}

export interface FillDiagnosis {
  total: number;
  filled: number;
  /** Fields the engine deliberately left alone — not failures. */
  skipped: number;
  causes: CauseGroup[];
}

const EXPLANATIONS: Record<FailureCause, string> = {
  "needs-your-answer":
    "the form asked something with no saved answer — answering once saves it for next time",
  "not-recognised": "the engine could not tell what these fields are asking, so it left them alone",
  "manual-upload": "a file picker only a person can open — expected, not a failure",
  "only-you-can-answer":
    "a guard refused to answer for you: these have a right answer only you know",
  "write-rejected": "a value was chosen and the page did not accept it — this one is a defect",
};

/**
 * Read the cause out of a row.
 *
 * The reason strings come from our own engine, so this is a lookup rather than
 * inference — but it matches on the CONCEPT rather than on one exact sentence.
 * The engine has four phrasings today and gained one the first time this was
 * written against a single example: "answer-bank pattern matched … but stored
 * answer is empty" is a question waiting on the user, and a pattern tied to
 * one wording missed it and filed it as unrecognised.
 *
 * Order matters. A guard refusal also reads as "no answer-bank match", and an
 * empty stored answer also mentions the answer bank, so the narrower cause is
 * always tested first.
 */
function causeOf(field: DiagnosableField): FailureCause {
  const reason = field.reason.toLowerCase();
  if (/guard|only you|refus/.test(reason)) return "only-you-can-answer";
  if (/file input|manual upload/.test(reason)) return "manual-upload";
  if (field.outcome === "failed" && field.source !== "none") return "write-rejected";
  // The engine understood the question — what it lacks is the answer. Whether
  // it says so as "open-ended", "needs-answer", "stored answer is empty" or
  // "no matching answer", the user's next move is the same: answer it once.
  if (
    /open-ended|needs-answer|stored answer is empty|no (matching )?answer|answer.bank match/.test(
      reason,
    )
  ) {
    return "needs-your-answer";
  }
  if (/no classifier match|left unknown/.test(reason)) return "not-recognised";
  // An outcome of "failed" with nothing chosen is a write that never had a
  // value, which is the engine not knowing rather than the page refusing.
  return field.outcome === "failed" ? "write-rejected" : "not-recognised";
}

/** Causes worth the user's attention first: things they can act on, then
 *  defects, then the ones that are working as designed. */
const CAUSE_ORDER: FailureCause[] = [
  "only-you-can-answer",
  "needs-your-answer",
  "write-rejected",
  "not-recognised",
  "manual-upload",
];

/** How many field names one cause may list before it stops being readable. */
const NAMES_PER_CAUSE = 8;

export function diagnoseFill(fields: DiagnosableField[]): FillDiagnosis {
  const filled = fields.filter((f) => f.outcome === "filled").length;
  const skipped = fields.filter((f) => f.outcome === "skipped").length;
  const problems = fields.filter((f) => f.outcome !== "filled" && f.outcome !== "skipped");

  const byCause = new Map<FailureCause, DiagnosableField[]>();
  for (const field of problems) {
    const cause = causeOf(field);
    byCause.set(cause, [...(byCause.get(cause) ?? []), field]);
  }

  const causes = CAUSE_ORDER.filter((c) => byCause.has(c)).map((cause): CauseGroup => {
    const group = byCause.get(cause)!;
    return {
      cause,
      explanation: EXPLANATIONS[cause],
      count: group.length,
      // A field with no label is still a field; naming it by nothing would
      // silently shorten the list and make the count disagree.
      fields: group.slice(0, NAMES_PER_CAUSE).map((f) => f.label || "(unlabelled field)"),
      requiredCount: group.filter((f) => f.required).length,
    };
  });

  return { total: fields.length, filled, skipped, causes };
}
