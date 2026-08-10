import { describe, expect, it } from "vitest";
import { auditCapturedForm, verifyCaptureRoundTrip } from "../capture-audit";
import { canaryPersonas } from "../canary";
import { discoverCapturedForms } from "./adaptation/captured-report";
import type { FieldDescriptor } from "../classify";

const d = (fieldId: string, over: Partial<FieldDescriptor>): FieldDescriptor => ({
  fieldId,
  label: "Question",
  name: "",
  autocomplete: "",
  type: "text",
  placeholder: "",
  ariaLabel: "",
  ...over,
});

const profile = canaryPersonas()[0]!.profile;

describe("auditCapturedForm", () => {
  it("accepts a well-formed capture", () => {
    const findings = auditCapturedForm([
      d("email", { label: "Email", type: "email" }),
      d("pronouns", { label: "Pronouns", type: "select", options: ["She/Her", "He/Him"] }),
    ]);
    expect(findings).toEqual([]);
  });

  it("refuses an empty capture", () => {
    expect(auditCapturedForm([])[0]?.severity).toBe("error");
  });

  it("refuses a choice control captured without its options", () => {
    const findings = auditCapturedForm([d("visa", { label: "Visa status", type: "select" })]);
    expect(findings.some((f) => f.severity === "error" && f.fieldId === "visa")).toBe(true);
  });

  it("refuses duplicate field identities", () => {
    const findings = auditCapturedForm([d("q1", {}), d("q1", {})]);
    expect(findings.some((f) => f.severity === "error" && /duplicate/.test(f.message))).toBe(true);
  });

  it("warns — not errors — on a field with no textual identity", () => {
    const findings = auditCapturedForm([d("mystery", { label: "" })]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe("warning");
  });

  it("every fixture already in the corpus passes the structural audit", () => {
    for (const { fixture } of discoverCapturedForms()) {
      const errors = auditCapturedForm(fixture.fields).filter((f) => f.severity === "error");
      expect(errors, fixture.formId).toEqual([]);
    }
  });
});

describe("verifyCaptureRoundTrip", () => {
  it("passes for serializable descriptors", () => {
    const fields = [
      d("email", { label: "Email", type: "email" }),
      d("skills", { label: "Skills", type: "text" }),
    ];
    expect(verifyCaptureRoundTrip(fields, profile)).toEqual([]);
  });

  it("trips on a descriptor shape JSON cannot carry — the regression tripwire", () => {
    // This is the gate's real job (see capture-audit.ts): not re-checking
    // today's already-JSON-safe fixtures, but failing loudly the day the
    // descriptor shape grows state that a fixture file cannot represent
    // (here simulated with a getter-only label). Without the tripwire that
    // day looks like nothing — captures just start replaying quietly wrong.
    const sneaky = d("email", { type: "email" });
    let read = 0;
    Object.defineProperty(sneaky, "label", {
      enumerable: false, // JSON.stringify skips it — the round trip loses the label
      get: () => {
        read += 1;
        return "Email";
      },
    });
    const divergences = verifyCaptureRoundTrip([sneaky], profile);
    expect(read).toBeGreaterThan(0);
    expect(divergences.length).toBeGreaterThan(0);
  });

  it("every fixture already in the corpus survives the round trip", () => {
    for (const { fixture } of discoverCapturedForms()) {
      expect(verifyCaptureRoundTrip(fixture.fields, profile), fixture.formId).toEqual([]);
    }
  });
});
