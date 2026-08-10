import type { FieldDescriptor } from "./classify";
import { explainFillPlan, type FieldTrace } from "./fill-plan";
import type { FillProfile } from "./types";

/**
 * Offline replay: run the real fill engine over captured field descriptors,
 * without a browser.
 *
 * This is the library the whole verification story leans on, so its one hard
 * rule is stated here: it calls `explainFillPlan` — the exact function the
 * extension runs on a live page — and nothing else. A replay that used its own
 * "simplified" fill logic would verify the simplification, not the engine, and
 * every conclusion drawn from it would be about the wrong program.
 *
 * Two consumers, two very different questions:
 *   - capture auditing (`capture-audit.ts`): "did the capture lose anything?" —
 *     replay the same profile on both sides of a round-trip and diff.
 *   - the canary lab (`canary.ts`): "does the value come from the ACTIVE
 *     profile, or did it just happen to fit?" — replay N distinguishable
 *     profiles and look for cross-contamination.
 */

export interface ReplayRow {
  fieldId: string;
  label: string;
  status: FieldTrace["status"];
  chosenValue: string;
  source: FieldTrace["source"];
  questionKey: string;
}

export function replayForm(fields: FieldDescriptor[], profile: FillProfile): ReplayRow[] {
  return explainFillPlan(fields, profile).trace.map((t) => ({
    fieldId: t.fieldId,
    label: t.label,
    status: t.status,
    chosenValue: t.chosenValue,
    source: t.source,
    questionKey: t.questionKey,
  }));
}

export interface ReplayDivergence {
  fieldId: string;
  what: "status" | "chosenValue" | "questionKey" | "missing-field";
  a: string;
  b: string;
}

/**
 * Field-by-field diff of two replays of the SAME profile. Empty means the two
 * inputs are equivalent as far as the engine can tell — which is the exact
 * definition of a faithful capture.
 */
export function diffReplays(a: ReplayRow[], b: ReplayRow[]): ReplayDivergence[] {
  const out: ReplayDivergence[] = [];
  const bById = new Map(b.map((row) => [row.fieldId, row]));
  const seen = new Set<string>();

  for (const rowA of a) {
    const rowB = bById.get(rowA.fieldId);
    seen.add(rowA.fieldId);
    if (!rowB) {
      out.push({ fieldId: rowA.fieldId, what: "missing-field", a: rowA.label, b: "" });
      continue;
    }
    if (rowA.status !== rowB.status) {
      out.push({ fieldId: rowA.fieldId, what: "status", a: rowA.status, b: rowB.status });
    }
    if (rowA.chosenValue !== rowB.chosenValue) {
      out.push({
        fieldId: rowA.fieldId,
        what: "chosenValue",
        a: rowA.chosenValue,
        b: rowB.chosenValue,
      });
    }
    if (rowA.questionKey !== rowB.questionKey) {
      out.push({
        fieldId: rowA.fieldId,
        what: "questionKey",
        a: rowA.questionKey,
        b: rowB.questionKey,
      });
    }
  }
  for (const rowB of b) {
    if (!seen.has(rowB.fieldId)) {
      out.push({ fieldId: rowB.fieldId, what: "missing-field", a: "", b: rowB.label });
    }
  }
  return out;
}
