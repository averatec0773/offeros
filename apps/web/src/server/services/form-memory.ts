import {
  atsFromUrl,
  detectIncidents,
  formFingerprint,
  isPreventableFailure,
  type TriggerField,
} from "@offeros/autofill";
import type { FieldReport } from "@offeros/core";
import type { Db } from "../db/client";
import {
  knownShapes,
  recordIncident,
  recordShapes,
  type FillIncidentRow,
  type ShapeSighting,
} from "../repositories/form-memory-repo";

/**
 * What a finished fill leaves behind: a record of every question it met, and an
 * incident for anything that actually went wrong.
 *
 * The point of writing this down is a decision that has not been made yet.
 * Whether it is worth spending model calls to LEARN from failed fills depends
 * on four numbers nobody currently has — how often something really goes wrong,
 * how much of the apparent failure is guards working correctly, whether the
 * same question genuinely recurs across employers, and whether a platform that
 * exposes no field metadata produces stable keys at all. Those numbers cost
 * nothing to collect and cannot be reasoned out from first principles, so they
 * are collected first and the expensive step is decided afterwards.
 *
 * Nothing here calls a model. Every judgement is an integer comparison over
 * reports the engine already writes (see `@offeros/autofill`'s triggers.ts for
 * why that matters: a model asked "did this go badly?" answers differently on
 * different days, which would make the incident RATE unmeasurable — and the
 * incident rate is the number the decision turns on).
 */

export interface FillOutcomeInput {
  applicationId: string;
  taskId: string;
  applyLink?: string;
  /** The task's full accumulated reports, not just the last batch — a wizard
   *  spreads one form over several pages and the shape of the FORM is what is
   *  being recorded. */
  reports: FieldReport[];
}

/**
 * Record one completed fill. Returns the incidents raised, which is normally
 * none — that is the designed outcome, not a failure to detect anything.
 *
 * Reports without a `questionKey` are ignored rather than keyed on something
 * weaker: the key is the whole basis of "have we met this", and a fabricated
 * one would quietly merge unrelated questions. An extension older than the
 * field simply contributes nothing.
 */
export function recordFillOutcome(
  db: Db,
  input: FillOutcomeInput,
  now: number = Date.now(),
): FillIncidentRow[] {
  const keyed = input.reports.filter(
    (report): report is FieldReport & { questionKey: string } =>
      typeof report.questionKey === "string" && report.questionKey !== "",
  );
  if (keyed.length === 0) return [];

  const vendor = atsFromUrl(input.applyLink);
  const keys = keyed.map((report) => report.questionKey);
  const known = knownShapes(db, keys, input.applicationId);

  // Read BEFORE writing: the triggers below ask whether a question is new, and
  // recording this fill's sightings first would make every question look
  // already-known.
  const fields: TriggerField[] = keyed.map((report) => ({
    questionKey: report.questionKey,
    label: report.label,
    outcome: report.outcome,
    reason: report.reason,
    source: report.source,
    required: report.required,
  }));

  const incidents = detectIncidents({
    fields,
    seen: known.seen,
    failedBefore: known.failedElsewhere,
    formIsNew: keys.every((key) => !known.seen.has(key)),
  });

  // One sighting per distinct question, not per control. A form can repeat a
  // question (an unlabelled pair, the same consent asked twice), and counting
  // it twice would inflate `seen_count` into something that no longer means
  // "how many fills met this question" — the denominator of every later claim
  // about recurrence.
  const sightings = new Map<string, ShapeSighting>();
  for (const [i, field] of fields.entries()) {
    const failed = isPreventableFailure(field);
    const existing = sightings.get(field.questionKey);
    if (existing) {
      // Any occurrence failing makes the question a failure for this fill.
      existing.failed ||= failed;
      continue;
    }
    sightings.set(field.questionKey, {
      questionKey: field.questionKey,
      question: keyed[i]!.label,
      classifiedType: keyed[i]!.classifiedType,
      failed,
    });
  }
  recordShapes(db, vendor, input.applicationId, [...sightings.values()], now);

  const fingerprint = formFingerprint(vendor, keys);
  return incidents.map((incident) =>
    recordIncident(
      db,
      {
        applicationId: input.applicationId,
        taskId: input.taskId,
        vendor,
        formFingerprint: fingerprint,
        triggerId: incident.trigger,
        questionKeys: incident.questionKeys,
        summary: incident.summary,
      },
      now,
    ),
  );
}
