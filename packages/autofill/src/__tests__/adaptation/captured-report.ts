// Loads captured/*.fixture.json (real ATS forms scanned from live job postings),
// fills each with the synthetic Jordan Rivera persona via explainFillPlan, and
// scores every field against its hand-authored ground truth (and, when present,
// against a reference oracle's answers). Unlike score-adaptation.ts's synthetic ATS_FORMS
// corpus, this compares against a real, messy form — see captured.test.ts for the
// assertions run over this report.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { explainFillPlan } from "../../fill-plan";
import type { FieldDescriptor } from "../../classify";
import type { FillStatus } from "../../fill-plan";
import { JORDAN_RIVERA_PROFILE } from "./captured/persona";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAPTURED_DIR = path.join(__dirname, "captured");

export interface CapturedFixture {
  ats: string;
  slug: string;
  formId: string;
  url: string;
  capturedAt: string;
  fields: FieldDescriptor[];
}

/** `<fieldId>: { label, expected, _note? }`; keys starting with "_" are metadata. */
export type GroundTruth = Record<
  string,
  { label: string; expected: string; _note?: string } | string
>;

/** `<fieldId>: { label, value }` — the reference oracle's answers, when captured. */
export type Oracle = Record<string, { label: string; value: string } | string>;

export interface CapturedFieldResult {
  fieldId: string;
  label: string;
  ours: string;
  groundTruth: string;
  oracle?: string;
  status: FillStatus;
  reason: string;
  correct: boolean;
  falsePositive: boolean;
}

export interface CapturedFormReport {
  formId: string;
  ats: string;
  slug: string;
  url: string;
  hasOracle: boolean;
  rows: CapturedFieldResult[];
  summary: { correct: number; applicable: number; falsePositives: number };
  /** Fields where our chosen value disagrees with the oracle's, oracle-present forms only. */
  divergencesFromOracle: { fieldId: string; label: string; ours: string; oracle: string }[];
}

const norm = (s: string) => s.trim().toLowerCase();

function groundTruthEntries(gt: GroundTruth): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(gt)) {
    if (key.startsWith("_")) continue;
    out[key] = typeof val === "string" ? val : val.expected;
  }
  return out;
}

function oracleEntries(oracle: Oracle | null): Record<string, string> {
  if (!oracle) return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(oracle)) {
    if (key.startsWith("_")) continue;
    out[key] = typeof val === "string" ? val : val.value;
  }
  return out;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf-8")) as T;
}

/** Discovers every captured/*.fixture.json and pairs it with its groundtruth (+ optional oracle). */
export function discoverCapturedForms(): {
  fixture: CapturedFixture;
  groundTruth: GroundTruth;
  oracle: Oracle | null;
}[] {
  if (!existsSync(CAPTURED_DIR)) return [];
  const fixtureFiles = readdirSync(CAPTURED_DIR)
    .filter((f) => f.endsWith(".fixture.json"))
    .sort();

  return fixtureFiles.map((file) => {
    const base = file.slice(0, -".fixture.json".length);
    const fixture = readJson<CapturedFixture>(path.join(CAPTURED_DIR, file));
    const groundTruth = readJson<GroundTruth>(path.join(CAPTURED_DIR, `${base}.groundtruth.json`));
    const oraclePath = path.join(CAPTURED_DIR, `${base}.oracle.json`);
    const oracle = existsSync(oraclePath) ? readJson<Oracle>(oraclePath) : null;
    return { fixture, groundTruth, oracle };
  });
}

/**
 * A field is CORRECT if our chosen value matches the ground-truth expected value
 * (trim + case-insensitive). An empty expected means "leave unfilled" — correct
 * iff we did NOT fill it (status !== "fillable") or our chosen value is empty.
 * Filling a field whose expected is empty is flagged as a false positive.
 */
function scoreField(
  chosenValue: string,
  status: FillStatus,
  expected: string,
): { correct: boolean; falsePositive: boolean } {
  const oursNorm = norm(chosenValue);
  const expectedNorm = norm(expected);
  if (expectedNorm === "") {
    const leftUnfilled = status !== "fillable" || oursNorm === "";
    return { correct: leftUnfilled, falsePositive: !leftUnfilled };
  }
  return { correct: oursNorm === expectedNorm, falsePositive: false };
}

export function scoreCapturedForm(
  fixture: CapturedFixture,
  groundTruth: GroundTruth,
  oracle: Oracle | null,
): CapturedFormReport {
  const { trace } = explainFillPlan(fixture.fields, JORDAN_RIVERA_PROFILE);
  const gt = groundTruthEntries(groundTruth);
  const oracleValues = oracleEntries(oracle);

  const rows: CapturedFieldResult[] = trace.map((t) => {
    const expected = gt[t.fieldId] ?? "";
    const { correct, falsePositive } = scoreField(t.chosenValue, t.status, expected);
    const oracleValue = oracle ? (oracleValues[t.fieldId] ?? "") : undefined;
    return {
      fieldId: t.fieldId,
      label: t.label,
      ours: t.chosenValue,
      groundTruth: expected,
      oracle: oracleValue,
      status: t.status,
      reason: t.reason,
      correct,
      falsePositive,
    };
  });

  const divergencesFromOracle = oracle
    ? rows
        .filter((r) => r.oracle !== undefined && norm(r.oracle) !== norm(r.ours))
        .map((r) => ({ fieldId: r.fieldId, label: r.label, ours: r.ours, oracle: r.oracle! }))
    : [];

  return {
    formId: fixture.formId,
    ats: fixture.ats,
    slug: fixture.slug,
    url: fixture.url,
    hasOracle: oracle !== null,
    rows,
    summary: {
      correct: rows.filter((r) => r.correct).length,
      applicable: rows.length,
      falsePositives: rows.filter((r) => r.falsePositive).length,
    },
    divergencesFromOracle,
  };
}

export function buildCapturedReports(): CapturedFormReport[] {
  return discoverCapturedForms().map(({ fixture, groundTruth, oracle }) =>
    scoreCapturedForm(fixture, groundTruth, oracle),
  );
}

/** Readable field | ours | ground-truth | [oracle] | status | reason table for console output. */
export function formatReportTable(report: CapturedFormReport): string {
  const header = `\n${report.formId} (${report.url})`;
  const lines = report.rows.map((r) => {
    const parts = [
      `  ${r.fieldId.padEnd(28)}`,
      `ours="${r.ours}"`.padEnd(30),
      `expected="${r.groundTruth}"`.padEnd(30),
    ];
    if (report.hasOracle) parts.push(`oracle="${r.oracle ?? ""}"`.padEnd(24));
    parts.push(r.correct ? "OK" : r.falsePositive ? "FALSE-POSITIVE" : "MISS");
    parts.push(`[${r.status}] ${r.reason}`);
    return parts.join("  ");
  });
  const summary = `  -- ${report.summary.correct}/${report.summary.applicable} correct, ${report.summary.falsePositives} false positive(s)`;
  return [header, ...lines, summary].join("\n");
}
