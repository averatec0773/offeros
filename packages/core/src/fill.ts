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

export const FIELD_REPORT_OUTCOMES = ["filled", "skipped", "needs-user", "failed"] as const;

export const fieldReportSchema = z.object({
  fieldId: z.string().min(1),
  label: z.string(),
  classifiedType: z.string(), // CanonicalField | "unknown" — string here; core must not depend on @offeros/autofill
  status: z.string(), // FillStatus from the engine, as reported
  value: z.string().optional(),
  source: z.string(), // "personal" | "answer-bank" | "skills" | "ai-generated" | "cover-letter" | "resume-file" | "cover-letter-file" | "none"
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

/** Derive the Action-Required contract from reports. status 2 iff any required field has outcome needs-user/failed/skipped; else 1. filledFields = labels (fallback fieldId) with outcome "filled"; missingFields = labels of required non-filled; totalFields = all labels. Returns undefined for empty reports. */
export function deriveApplicationInfo(reports: FieldReport[]): ApplicationInfo | undefined {
  if (reports.length === 0) return undefined;

  const filledFields = reports.filter((r) => r.outcome === "filled").map(fieldLabel);
  const missingFields = reports.filter((r) => r.required && r.outcome !== "filled").map(fieldLabel);
  const totalFields = reports.map(fieldLabel);
  const status = missingFields.length > 0 ? 2 : 1;

  return {
    status,
    filledFields,
    missingFields,
    totalFields,
  };
}
