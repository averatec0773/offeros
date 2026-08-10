import { diagnoseFill, type DiagnosableField } from "./diagnose";

/**
 * When a fill is worth analysing — decided without a model.
 *
 * The premise of the whole learning design is that most fills do not need
 * anything spent on them. Applying to hundreds of jobs and calling a model to
 * study each one costs roughly as much again as the entire existing pipeline,
 * to examine forms that mostly worked. So the question "did something actually
 * go wrong here?" is answered by integer comparisons over records the engine
 * already writes.
 *
 * There is a second, better reason not to use a model for it. A model asked
 * "did this fill go badly?" gives a different answer on different days for the
 * same input, which makes the trigger RATE unmeasurable — and the trigger rate
 * is the number that tells you whether any of this is worth building.
 *
 * The key insight is in diagnose.ts: of the five failure causes, three are the
 * engine working correctly. A guard refusing a demographic question, a file
 * only a person can upload, and a question the user has simply never answered
 * are not defects. Triggering on "anything that is not filled" would fire on
 * almost every application and spend most of its budget admiring the guard
 * rails.
 */

export type TriggerId =
  /** A required question the engine could not classify, never seen before. */
  | "unrecognised-required"
  /** A value was chosen and the page refused it. A regression, not a novelty —
   *  so this fires even on a form we have handled many times. */
  | "write-rejected"
  /** Broadly failed a form we have not met: many fields individually below the
   *  bar for the first trigger. */
  | "coverage-cliff"
  /** The same question has now failed on two different applications. Catches
   *  optional questions that are individually ignorable and appear everywhere. */
  | "repeat-offender";

export interface TriggerField extends DiagnosableField {
  /** Stable identity of the question (see fingerprint.ts). */
  questionKey: string;
}

export interface TriggerInput {
  fields: TriggerField[];
  /** Question keys recorded from any previous fill. */
  seen: ReadonlySet<string>;
  /**
   * Question keys that have already failed to classify on a DIFFERENT
   * application. Distinct applications matter: the same question failing twice
   * on one form is one problem, not two sightings.
   */
  failedBefore: ReadonlySet<string>;
  /** True when nothing in `seen` came from this form before. Diagnostic input
   *  for the coverage trigger only. */
  formIsNew: boolean;
}

export interface Incident {
  trigger: TriggerId;
  /** The questions this incident is about. Never every failed field — only the
   *  ones worth spending on. */
  questionKeys: string[];
  /** One line for the ledger and for the user, in the words a person uses. */
  summary: string;
}

/**
 * Required-field coverage below this on a form we have not met means the form
 * as a whole went badly, even if no single question tripped another trigger.
 */
const COVERAGE_FLOOR = 0.6;

/** Questions to carry in one incident. More than this and the analysis stops
 *  being about a problem and starts being about a form. */
const MAX_QUESTIONS = 5;

/**
 * Causes that mean the engine worked. A field carrying one of these is never
 * part of an incident, whatever else is true of it — including via the coverage
 * trigger, which is why they are excluded from that denominator too.
 */
function isEngineWorking(field: DiagnosableField): boolean {
  const reason = field.reason.toLowerCase();
  if (/guard|only you|refus/.test(reason)) return true;
  if (/file input|manual upload/.test(reason)) return true;
  // A question with no saved answer is a data gap the user closes by answering
  // once. Learning from it is free (the answer bank already exists) and needs
  // no analysis.
  return /open-ended|needs-answer|stored answer is empty|no (matching )?answer|answer.bank match/.test(
    reason,
  );
}

const isUnrecognised = (field: DiagnosableField): boolean =>
  !isEngineWorking(field) && /no classifier match|left unknown/.test(field.reason.toLowerCase());

const isWriteRejected = (field: DiagnosableField): boolean =>
  field.outcome === "failed" && field.source !== "none";

/**
 * Every incident this fill is worth raising. Empty is the common case and the
 * designed outcome.
 *
 * Deliberately returns a LIST rather than one verdict: a form can be both new
 * and carry a regression, and those are different problems with different
 * fixes. Collapsing them would lose the regression, which is the more urgent.
 */
export function detectIncidents(input: TriggerInput): Incident[] {
  const { fields, seen, failedBefore } = input;
  const incidents: Incident[] = [];
  const claimed = new Set<string>();

  /** Take up to MAX_QUESTIONS keys not already claimed by an earlier trigger,
   *  so one question is not analysed twice in one fill. */
  const take = (candidates: TriggerField[]): string[] => {
    const keys: string[] = [];
    for (const field of candidates) {
      if (claimed.has(field.questionKey) || keys.includes(field.questionKey)) continue;
      keys.push(field.questionKey);
      if (keys.length >= MAX_QUESTIONS) break;
    }
    for (const key of keys) claimed.add(key);
    return keys;
  };

  // Ordered by urgency: a value the page refused is a regression on something
  // that used to work, which matters more than a question never met.
  const rejected = fields.filter(isWriteRejected);
  if (rejected.length > 0) {
    const keys = take(rejected);
    if (keys.length > 0) {
      incidents.push({
        trigger: "write-rejected",
        questionKeys: keys,
        summary: `${rejected.length} field${rejected.length === 1 ? "" : "s"} had a value chosen and the page refused it`,
      });
    }
  }

  const unrecognised = fields.filter(isUnrecognised);

  const newRequired = unrecognised.filter((f) => f.required && !seen.has(f.questionKey));
  if (newRequired.length > 0) {
    const keys = take(newRequired);
    if (keys.length > 0) {
      incidents.push({
        trigger: "unrecognised-required",
        questionKeys: keys,
        summary: `${keys.length} required question${keys.length === 1 ? "" : "s"} the engine has never seen and cannot classify`,
      });
    }
  }

  const repeats = unrecognised.filter((f) => failedBefore.has(f.questionKey));
  if (repeats.length > 0) {
    const keys = take(repeats);
    if (keys.length > 0) {
      incidents.push({
        trigger: "repeat-offender",
        questionKeys: keys,
        summary: `${keys.length} question${keys.length === 1 ? "" : "s"} that also failed on another application`,
      });
    }
  }

  // Last, and only if nothing more specific already covers the form: a form we
  // broadly failed at. Firing this alongside a specific trigger would pay twice
  // for the same page.
  //
  // It also only considers questions never recorded. A form whose failures are
  // all on questions we have already met is not a discovery — re-analysing it
  // because this particular posting is new would pay again for the same
  // knowledge, every time that employer posts a role.
  if (input.formIsNew && incidents.length === 0) {
    const coverage = requiredCoverage(fields);
    const unseen = fields.filter((f) => !seen.has(f.questionKey));
    if (coverage !== null && coverage < COVERAGE_FLOOR && unseen.length > 0) {
      const unseenUnrecognised = unrecognised.filter((f) => !seen.has(f.questionKey));
      const keys = take(
        unseenUnrecognised.length > 0 ? unseenUnrecognised : unseen.filter((f) => f.required),
      );
      if (keys.length > 0) {
        incidents.push({
          trigger: "coverage-cliff",
          questionKeys: keys,
          summary: `only ${Math.round(coverage * 100)}% of required fields filled on a form not seen before`,
        });
      }
    }
  }

  return incidents;
}

/**
 * Share of required fields that filled, over the ones the engine could
 * reasonably have filled. Null when there is nothing to measure — a form of
 * entirely optional questions is not a failure.
 */
export function requiredCoverage(fields: DiagnosableField[]): number | null {
  const diagnosis = diagnoseFill(fields);
  if (diagnosis.total === 0) return null;
  const required = fields.filter((f) => f.required && f.outcome !== "skipped");
  const ours = required.filter((f) => f.outcome === "filled" || !isEngineWorking(f));
  if (ours.length === 0) return null;
  return ours.filter((f) => f.outcome === "filled").length / ours.length;
}
