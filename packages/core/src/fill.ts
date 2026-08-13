import { z } from "zod";
import type { ApplicationInfo } from "./pipeline-task";

export const FILL_HANDOFF_STATUSES = ["pending", "claimed", "completed", "cancelled"] as const;

export const fillHandoffSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  applicationId: z.string().min(1),
  applyLink: z.string().optional(),
  status: z.enum(FILL_HANDOFF_STATUSES),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/**
 * What became of one field.
 *
 * `skipped` is the narrow one and the easy one to misuse: it means the engine
 * met a control, did not recognise it, and correctly did nothing to it. Every
 * consumer treats it as a non-event — it is not a problem in the diagnosis, it
 * is dropped from the required count, and the hand-back list only surfaces one
 * if it is required as well. So a field we HAD an answer for must never be
 * filed here; it is `filled`, an explicit `failed`, or `needs-user`. Four
 * fields once landed in `skipped` with their answers ready and went out of a
 * real application empty and unmentioned by everything downstream.
 */
export const FIELD_REPORT_OUTCOMES = ["filled", "skipped", "needs-user", "failed"] as const;

export const fieldReportSchema = z.object({
  fieldId: z.string().min(1),
  label: z.string(),
  classifiedType: z.string(), // CanonicalField | "unknown" — string here; core must not depend on @offeros/autofill
  status: z.string(), // FillStatus from the engine, as reported
  value: z.string().optional(),
  source: z.string(), // "personal" | "answer-bank" | "skills" | "ai-generated" | "ai-classified" | "cover-letter" | "resume-file" | "cover-letter-file" | "none"
  reason: z.string(),
  outcome: z.enum(FIELD_REPORT_OUTCOMES),
  required: z.boolean(),
  page: z.string().optional(),
  /**
   * Stable identity of the question this field asks, computed by the fill
   * engine (see `@offeros/autofill`'s fingerprint.ts). Optional because it is
   * the extension that computes it — a panel older than this field still
   * reports, it just contributes nothing to form memory.
   *
   * Unlike `fieldId` this survives across postings: `fieldId` is a per-render
   * DOM handle, this is "the same question, wherever it appears".
   */
  questionKey: z.string().optional(),
});

export type FillHandoff = z.infer<typeof fillHandoffSchema>;
export type FillHandoffStatus = (typeof FILL_HANDOFF_STATUSES)[number];
export type FieldReport = z.infer<typeof fieldReportSchema>;
/** The outcome vocabulary, as a type — both apps switch on it. */
export type FieldReportOutcome = (typeof FIELD_REPORT_OUTCOMES)[number];

function reportKey(report: FieldReport): string {
  return `${report.page ?? ""} ${report.fieldId}`;
}

/** Merge new reports into existing by (page ?? "") + fieldId; new wins. Order: existing order, then new fields in report order. */
export function mergeFieldReports(existing: FieldReport[], incoming: FieldReport[]): FieldReport[] {
  const incomingByKey = new Map(incoming.map((report) => [reportKey(report), report]));
  const merged: FieldReport[] = [];
  const seen = new Set<string>();

  for (const report of existing) {
    const key = reportKey(report);
    merged.push(incomingByKey.get(key) ?? report);
    seen.add(key);
  }

  for (const report of incoming) {
    const key = reportKey(report);
    if (!seen.has(key)) {
      merged.push(report);
      seen.add(key);
    }
  }

  return merged;
}

function fieldLabel(report: FieldReport): string {
  return report.label.trim() || report.fieldId;
}

/**
 * Derive the Action-Required contract from reports.
 *
 * `status` is 2 when any REQUIRED field is not filled, else 1.
 *
 * Four lists, and the distinction between them is the whole point. `totalFields`
 * is every control the engine met — including the ones it correctly left alone,
 * which on a real form was 32 of 73. `requiredFields` is the population a
 * progress figure should actually be about: on that same form, 24. Reporting
 * "23/73 required fields filled" was wrong twice over, since 23 counted every
 * filled field rather than the required ones (17) and 73 counted every control
 * rather than the required ones.
 */
export function deriveApplicationInfo(reports: FieldReport[]): ApplicationInfo | undefined {
  if (reports.length === 0) return undefined;

  const filledFields = reports.filter((r) => r.outcome === "filled").map(fieldLabel);
  const missingFields = reports.filter((r) => r.required && r.outcome !== "filled").map(fieldLabel);
  const totalFields = reports.map(fieldLabel);
  const requiredReports = reports.filter((r) => r.required);
  const requiredFields = requiredReports.map(fieldLabel);
  const requiredFilledFields = requiredReports
    .filter((r) => r.outcome === "filled")
    .map(fieldLabel);
  const status = missingFields.length > 0 ? 2 : 1;

  return {
    status,
    filledFields,
    missingFields,
    totalFields,
    requiredFields,
    requiredFilledFields,
  };
}
