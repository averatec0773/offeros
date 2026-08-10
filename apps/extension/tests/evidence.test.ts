import { describe, expect, it } from "vitest";
import { pickEvidenceFields, MAX_EVIDENCE_SHOTS } from "../src/lib/autofill/evidence";
import type { FieldReport } from "../src/lib/offeros-api";

const report = (over: Partial<FieldReport>): FieldReport => ({
  fieldId: "f1",
  label: "Question",
  classifiedType: "unknown",
  status: "fillable",
  source: "personal",
  reason: "matched profile.personal.email",
  outcome: "filled",
  required: false,
  ...over,
});

const unrecognised = (over: Partial<FieldReport>): FieldReport =>
  report({
    source: "none",
    reason: "no classifier match → left unknown",
    outcome: "skipped",
    ...over,
  });

describe("pickEvidenceFields", () => {
  it("photographs only preventable failures — the incident set, exactly", () => {
    const picked = pickEvidenceFields([
      report({ fieldId: "ok" }),
      unrecognised({ fieldId: "miss" }),
      report({
        fieldId: "guarded",
        outcome: "needs-user",
        source: "none",
        reason: "sensitive guard: only you can answer this",
      }),
      report({ fieldId: "rejected", outcome: "failed", source: "personal" }),
    ]);
    expect(picked.map((r) => r.fieldId).sort()).toEqual(["miss", "rejected"]);
  });

  it("caps the shots and puts required fields first", () => {
    const picked = pickEvidenceFields([
      unrecognised({ fieldId: "a" }),
      unrecognised({ fieldId: "b", required: true }),
      unrecognised({ fieldId: "c" }),
      unrecognised({ fieldId: "d", required: true }),
    ]);
    expect(picked).toHaveLength(MAX_EVIDENCE_SHOTS);
    expect(picked.slice(0, 2).every((r) => r.required)).toBe(true);
  });

  it("returns nothing for a clean fill — no evidence theatre", () => {
    expect(pickEvidenceFields([report({}), report({ fieldId: "b" })])).toEqual([]);
  });
});
