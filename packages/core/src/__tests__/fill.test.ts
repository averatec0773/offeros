import { describe, it, expect } from "vitest";
import {
  fillHandoffSchema,
  fieldReportSchema,
  mergeFieldReports,
  deriveApplicationInfo,
  FILL_HANDOFF_STATUSES,
  FIELD_REPORT_OUTCOMES,
  type FieldReport,
} from "../fill";

describe("fillHandoffSchema", () => {
  it("round-trips a valid handoff ticket", () => {
    const handoff = fillHandoffSchema.parse({
      id: "h1",
      taskId: "t1",
      applicationId: "app-1",
      applyLink: "https://example.com/apply",
      status: "pending",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(handoff.status).toBe("pending");
    expect(FILL_HANDOFF_STATUSES).toEqual(["pending", "claimed", "completed", "cancelled"]);
  });

  it("rejects an unknown status", () => {
    const bad = fillHandoffSchema.safeParse({
      id: "h1",
      taskId: "t1",
      applicationId: "app-1",
      status: "bogus",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(bad.success).toBe(false);
  });
});

describe("fieldReportSchema", () => {
  it("round-trips a valid field report", () => {
    const report = fieldReportSchema.parse({
      fieldId: "f1",
      label: "First Name",
      classifiedType: "firstName",
      status: "filled",
      value: "Jordan",
      source: "personal",
      reason: "matched personal.firstName",
      outcome: "filled",
      required: true,
      page: "page-1",
    });
    expect(report.outcome).toBe("filled");
    expect(FIELD_REPORT_OUTCOMES).toEqual(["filled", "skipped", "needs-user", "failed"]);
  });

  it("rejects an unknown outcome", () => {
    const bad = fieldReportSchema.safeParse({
      fieldId: "f1",
      label: "First Name",
      classifiedType: "firstName",
      status: "filled",
      source: "personal",
      reason: "x",
      outcome: "bogus",
      required: true,
    });
    expect(bad.success).toBe(false);
  });
});

function makeReport(overrides: Partial<FieldReport>): FieldReport {
  return {
    fieldId: "f1",
    label: "Field 1",
    classifiedType: "unknown",
    status: "filled",
    source: "none",
    reason: "",
    outcome: "filled",
    required: false,
    ...overrides,
  };
}

describe("mergeFieldReports", () => {
  it("replaces reports matching (page, fieldId) and appends new ones", () => {
    const existing: FieldReport[] = [
      makeReport({ fieldId: "f1", page: "p1", label: "old label", outcome: "skipped" }),
      makeReport({ fieldId: "f2", page: "p1", label: "field 2" }),
    ];
    const incoming: FieldReport[] = [
      makeReport({ fieldId: "f1", page: "p1", label: "new label", outcome: "filled" }),
      makeReport({ fieldId: "f3", page: "p1", label: "field 3" }),
    ];

    const merged = mergeFieldReports(existing, incoming);

    expect(merged.map((r) => r.fieldId)).toEqual(["f1", "f2", "f3"]);
    expect(merged[0]!.label).toBe("new label");
    expect(merged[0]!.outcome).toBe("filled");
  });

  it("treats missing page as its own bucket, distinct across pages", () => {
    const existing: FieldReport[] = [
      makeReport({ fieldId: "f1", page: undefined, label: "no page" }),
    ];
    const incoming: FieldReport[] = [makeReport({ fieldId: "f1", page: "p1", label: "with page" })];

    const merged = mergeFieldReports(existing, incoming);

    expect(merged).toHaveLength(2);
  });
});

describe("deriveApplicationInfo", () => {
  it("returns undefined for empty reports", () => {
    expect(deriveApplicationInfo([])).toBeUndefined();
  });

  it("status 1 when all required fields are filled (optional skipped doesn't matter)", () => {
    const reports: FieldReport[] = [
      makeReport({ fieldId: "f1", label: "First Name", required: true, outcome: "filled" }),
      makeReport({ fieldId: "f2", label: "Middle Name", required: false, outcome: "skipped" }),
    ];

    const info = deriveApplicationInfo(reports);

    expect(info?.status).toBe(1);
    expect(info?.filledFields).toEqual(["First Name"]);
    expect(info?.totalFields).toEqual(["First Name", "Middle Name"]);
  });

  it("status 2 when a required field needs-user/failed/skipped, listing missingFields", () => {
    const reports: FieldReport[] = [
      makeReport({ fieldId: "f1", label: "First Name", required: true, outcome: "filled" }),
      makeReport({
        fieldId: "f2",
        label: "LinkedIn Profile",
        required: true,
        outcome: "needs-user",
      }),
      makeReport({ fieldId: "f3", label: "Resume Upload", required: true, outcome: "failed" }),
      makeReport({ fieldId: "f4", label: "Cover Letter", required: true, outcome: "skipped" }),
      makeReport({ fieldId: "f5", label: "Nickname", required: false, outcome: "needs-user" }),
    ];

    const info = deriveApplicationInfo(reports);

    expect(info?.status).toBe(2);
    expect(info?.missingFields).toEqual(["LinkedIn Profile", "Resume Upload", "Cover Letter"]);
    expect(info?.filledFields).toEqual(["First Name"]);
    expect(info?.totalFields).toEqual([
      "First Name",
      "LinkedIn Profile",
      "Resume Upload",
      "Cover Letter",
      "Nickname",
    ]);
  });

  it("falls back to fieldId when label is blank", () => {
    const reports: FieldReport[] = [
      makeReport({ fieldId: "f1", label: "  ", required: true, outcome: "filled" }),
    ];

    const info = deriveApplicationInfo(reports);

    expect(info?.filledFields).toEqual(["f1"]);
  });
});
