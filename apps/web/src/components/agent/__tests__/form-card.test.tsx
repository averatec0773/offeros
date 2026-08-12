// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { PIPELINE_STEPS, type FieldReport, type PipelineTask } from "@offeros/core";
import type { FillIncidentRow } from "@/server/repositories/form-memory-repo";
import { FormCard } from "../form-card";

/**
 * Three cards became one, and the merge must not have cost anything: the
 * entry point, the report, the needs-you block and its three resolutions all
 * still work, and detail is present but out of the way.
 */

afterEach(cleanup);

const field = (over: Partial<FieldReport>): FieldReport => ({
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

const task = (over: Partial<PipelineTask> = {}): PipelineTask => ({
  id: "t1",
  applicationId: "app-1",
  status: "awaiting_user",
  coverLetterRequirement: "unknown",
  skippedCoverLetter: false,
  step: PIPELINE_STEPS.findIndex((s) => s.key === "fill-form"),
  fieldReports: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const incident: FillIncidentRow = {
  id: "i1",
  applicationId: "app-1",
  taskId: "t1",
  vendor: "greenhouse",
  formFingerprint: "f1",
  triggerId: "required-question-unseen",
  summary: "A required question we had never met before",
  questionKeys: ["k1"],
  status: "open",
  at: 1,
};

function mount(over: Partial<Parameters<typeof FormCard>[0]> = {}) {
  const props = {
    task: null,
    incidents: [],
    onOpenAndFill: vi.fn(),
    onFixed: vi.fn(),
    onApplied: vi.fn(),
    ...over,
  };
  render(<FormCard {...props} />);
  return props;
}

describe("never filled", () => {
  it("is just the entry point", () => {
    const props = mount();
    expect(screen.getByText(/the browser panel fills it/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open & fill" }));
    expect(props.onOpenAndFill).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Field by field/ })).toBeNull();
  });
});

describe("filled", () => {
  const filled = task({
    fieldReports: [
      field({ label: "Email", outcome: "filled" }),
      field({ label: "Phone", outcome: "filled" }),
      field({ label: "Why us?", outcome: "needs-user", required: true }),
      field({ label: "Hidden", outcome: "skipped" }),
    ],
  });

  it("leads with the count, against the honest denominator", () => {
    mount({ task: filled });
    // Four reports, one deliberately skipped → 2 of 3 fillable, not 2 of 4.
    expect(screen.getByText(/2 of 3 fillable fields filled/)).toBeTruthy();
    expect(screen.getByText(/1 standard fields skipped/)).toBeTruthy();
  });

  it("keeps the field detail, one click in", () => {
    mount({ task: filled });
    expect(screen.queryByText("Email")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Field by field/ }));
    expect(screen.getByText("Email")).toBeTruthy();
  });

  it("offers a re-fill rather than a first fill", () => {
    const props = mount({ task: filled });
    fireEvent.click(screen.getByRole("button", { name: "Re-fill" }));
    expect(props.onOpenAndFill).toHaveBeenCalled();
  });
});

describe("something needs you", () => {
  const stuck = task({
    fieldReports: [field({ label: "Email" })],
    applicationInfo: {
      status: 2,
      filledFields: ["Email"],
      missingFields: ["Why this company?"],
      totalFields: ["Email", "Why this company?"],
    },
  });

  it("puts the needs-you block first and keeps all three resolutions", () => {
    const props = mount({ task: stuck });
    expect(screen.getByText(/Action Required/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /I've applied/i }));
    expect(props.onApplied).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Fixed/i }));
    expect(props.onFixed).toHaveBeenCalled();
  });
});

describe("incidents", () => {
  it("are kept, but folded away — they are engine material, not user reading", () => {
    mount({ task: task({ fieldReports: [field({})] }), incidents: [incident] });
    expect(screen.queryByText(/never met before/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /What went wrong here/ }));
    expect(screen.getByText(/never met before/)).toBeTruthy();
  });

  it("say nothing at all when there were none", () => {
    mount({ task: task({ fieldReports: [field({})] }), incidents: [] });
    expect(screen.queryByRole("button", { name: /What went wrong here/ })).toBeNull();
  });
});
