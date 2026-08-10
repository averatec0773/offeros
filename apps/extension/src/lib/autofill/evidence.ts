import { isPreventableFailure } from "@offeros/autofill";
import type { FieldReport } from "../offeros-api";

/**
 * Which fields deserve a screenshot when a fill finishes.
 *
 * Only preventable failures — the same predicate the incident triggers use
 * (`isPreventableFailure`), so the set of fields photographed is exactly the
 * set the learning loop will later ask questions about. A guard refusing a
 * demographic question and a file input waiting for a human are the system
 * working; photographing them would teach an auditor to skim past evidence.
 *
 * Capped, required-first: on a badly-broken form the first few required
 * misses tell the story, and thirty screenshots of the same broken page are
 * worse evidence than three.
 */

export const MAX_EVIDENCE_SHOTS = 3;

export function pickEvidenceFields(
  reports: FieldReport[],
  cap: number = MAX_EVIDENCE_SHOTS,
): FieldReport[] {
  return reports
    .filter(isPreventableFailure)
    .sort((a, b) => Number(b.required) - Number(a.required))
    .slice(0, Math.max(0, cap));
}
