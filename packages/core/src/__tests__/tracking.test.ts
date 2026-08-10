import { describe, expect, it } from "vitest";
import { describeTracking, trackApplication } from "../tracking";
import type { FieldReport } from "../fill";

const report = (outcome: FieldReport["outcome"]): FieldReport => ({
  fieldId: "f",
  label: "q",
  classifiedType: "unknown",
  status: "x",
  source: "none",
  reason: "",
  outcome,
  required: false,
});

describe("trackApplication", () => {
  it("says nothing happened when no form was ever filled", () => {
    const t = trackApplication({ status: "saved", updatedAt: 1 });
    expect(t.stage).toBe("not-started");
    expect(t.lastFilledAt).toBeUndefined();
    expect(describeTracking(t)).toBe("Not started");
  });

  it("counts what was filled and what still needs the user", () => {
    // The line someone reads three days later to remember where they left off.
    const t = trackApplication({
      status: "applying",
      updatedAt: 1234,
      fieldReports: [report("filled"), report("filled"), report("needs-user"), report("failed")],
    });
    expect(t.stage).toBe("filled");
    expect(t.filledFields).toBe(2);
    expect(t.needsUser).toBe(2);
    expect(t.lastFilledAt).toBe(1234);
    expect(describeTracking(t)).toBe("Filled 2/4 · 2 need you");
  });

  it("leaves skipped controls out of the total", () => {
    // They were never questions; counting them makes every form look half-done.
    const t = trackApplication({
      status: "applying",
      updatedAt: 1,
      fieldReports: [report("filled"), report("skipped"), report("skipped")],
    });
    expect(t.totalFields).toBe(1);
    expect(describeTracking(t)).toBe("Filled 1/1");
  });

  it("reports submission with the date the user recorded", () => {
    const t = trackApplication({
      status: "applied",
      appliedAt: 999,
      updatedAt: 1,
      fieldReports: [report("filled"), report("needs-user")],
    });
    expect(t.stage).toBe("submitted");
    expect(t.submittedAt).toBe(999);
    // Once submitted, "2 need you" would be nagging about a closed application.
    expect(describeTracking(t)).toBe("Submitted · filled 1/2");
  });

  it("still reads as submitted when no fill was ever recorded", () => {
    // Applying by hand and marking it afterwards is a real path.
    const t = trackApplication({ status: "applied", appliedAt: 5, updatedAt: 1 });
    expect(describeTracking(t)).toBe("Submitted");
  });
});
