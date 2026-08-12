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

  it("round-trips the file-attach sources (resume-file, cover-letter-file) — additive, old reports unaffected", () => {
    const resumeFile = fieldReportSchema.parse({
      fieldId: "f1",
      label: "Resume/CV",
      classifiedType: "resume",
      status: "needs-answer",
      value: "Jordan_Rivera_Resume.pdf",
      source: "resume-file",
      reason: "attached the tailored résumé PDF",
      outcome: "filled",
      required: true,
    });
    expect(resumeFile.source).toBe("resume-file");

    const coverLetterFile = fieldReportSchema.parse({
      fieldId: "f2",
      label: "Cover letter",
      classifiedType: "coverLetter",
      status: "needs-answer",
      source: "cover-letter-file",
      reason: "no file available to attach",
      outcome: "needs-user",
      required: false,
    });
    expect(coverLetterFile.source).toBe("cover-letter-file");

    // an old report (pre-Phase-9 source vocabulary) still parses unchanged.
    const old = fieldReportSchema.parse({
      fieldId: "f3",
      label: "Email",
      classifiedType: "email",
      status: "filled",
      value: "a@b.c",
      source: "personal",
      reason: "matched personal.email",
      outcome: "filled",
      required: true,
    });
    expect(old.source).toBe("personal");
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

/**
 * Counting the population the words describe.
 *
 * The Action-Required card says "N/M required fields filled". It used to be
 * given every filled field over every control the engine met — on a real form,
 * "23/73" when the truth was 17 of 24, because 73 counted 32 controls the
 * engine had correctly left alone and 23 counted optional fields too.
 */
describe("required-field counts", () => {
  const report = (over: Partial<FieldReport>): FieldReport => ({
    fieldId: Math.random().toString(36).slice(2),
    label: "Field",
    classifiedType: "unknown",
    status: "filled",
    source: "personal",
    reason: "",
    outcome: "filled",
    required: false,
    ...over,
  });

  it("counts only required fields, filled and total", () => {
    const info = deriveApplicationInfo([
      report({ label: "Email", required: true, outcome: "filled" }),
      report({ label: "Name", required: true, outcome: "filled" }),
      report({ label: "Why us?", required: true, outcome: "needs-user" }),
      report({ label: "Newsletter", required: false, outcome: "filled" }),
      report({ label: "Decorative", required: false, outcome: "skipped" }),
    ])!;

    expect(info.requiredFields).toEqual(["Email", "Name", "Why us?"]);
    expect(info.requiredFilledFields).toEqual(["Email", "Name"]);
    // The old numbers, kept because other readers use them.
    expect(info.filledFields).toHaveLength(3);
    expect(info.totalFields).toHaveLength(5);
  });

  it("a form where the engine skipped most controls does not read as mostly unfilled", () => {
    // The real shape: 24 required, 17 of them filled, and 32 skipped controls
    // that were never the user's problem.
    const reports = [
      ...Array.from({ length: 17 }, (_, i) =>
        report({ label: `req-${i}`, required: true, outcome: "filled" }),
      ),
      ...Array.from({ length: 7 }, (_, i) =>
        report({ label: `open-${i}`, required: true, outcome: "needs-user" }),
      ),
      ...Array.from({ length: 32 }, (_, i) =>
        report({ label: `skip-${i}`, required: false, outcome: "skipped" }),
      ),
      ...Array.from({ length: 17 }, (_, i) =>
        report({ label: `opt-${i}`, required: false, outcome: "filled" }),
      ),
    ];
    const info = deriveApplicationInfo(reports)!;
    expect(info.requiredFilledFields).toHaveLength(17);
    expect(info.requiredFields).toHaveLength(24);
    expect(info.totalFields).toHaveLength(73);
  });

  it("says nothing is required when nothing is", () => {
    const info = deriveApplicationInfo([report({ label: "Optional", outcome: "filled" })])!;
    expect(info.requiredFields).toEqual([]);
    expect(info.requiredFilledFields).toEqual([]);
    expect(info.status).toBe(1);
  });
});
