import { describe, expect, it } from "vitest";
import { buildCapturedReports, formatReportTable } from "./captured-report";

describe("autofill against captured real-world forms", () => {
  const reports = buildCapturedReports();

  it("discovered at least one captured form", () => {
    expect(reports.length).toBeGreaterThan(0);
  });

  it("prints the ours-vs-ground-truth(-vs-oracle) comparison table", () => {
    const tables = reports.map(formatReportTable).join("\n");
    console.log(`\nCaptured-form autofill report:\n${tables}\n`);
    expect(reports.length).toBeGreaterThan(0);
  });

  it("never produces a false positive on a captured form (e.g. resume file input, screening notes)", () => {
    const falsePositives = reports.flatMap((r) =>
      r.rows
        .filter((row) => row.falsePositive)
        .map((row) => `${r.formId}/${row.fieldId}: "${row.label}"`),
    );
    expect(falsePositives).toEqual([]);
  });

  it("fills the core identity fields correctly on the Anthropic form", () => {
    const anthropic = reports.find((r) => r.formId === "greenhouse-anthropic-fellows");
    expect(anthropic).toBeDefined();
    if (!anthropic) return;

    const byId = new Map(anthropic.rows.map((r) => [r.fieldId, r]));
    for (const fieldId of ["first_name", "last_name", "email"]) {
      const row = byId.get(fieldId);
      expect(row, `${fieldId} missing from captured report`).toBeDefined();
      expect(row!.correct, `${fieldId}: ours="${row!.ours}" expected="${row!.groundTruth}"`).toBe(
        true,
      );
      expect(row!.status).toBe("fillable");
    }
  });
});
