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

/**
 * The end of a clean fill.
 *
 * A completely successful fill parks the task at the submit gate, and until now
 * the page said nothing at all about it — the card showed a count, the only
 * hint that anything was waiting lived in a separate inbox, and pressing
 * "Re-fill" from there produced "Something went wrong."
 */
describe("ready to submit", () => {
  const parked = task({
    step: PIPELINE_STEPS.findIndex((s) => s.key === "submit"),
    fieldReports: [field({ label: "Email" }), field({ label: "Phone" })],
    applicationInfo: { status: 1, filledFields: ["Email", "Phone"] },
  });

  it("says what is left, and that it is the user's", () => {
    mount({ task: parked, readyToSubmit: true });
    expect(screen.getByText(/Everything we could fill is filled/)).toBeTruthy();
    // The promise the whole product rests on, at the moment it applies.
    expect(screen.getByText(/never presses submit/i)).toBeTruthy();
  });

  it("offers the two things that can happen next", () => {
    const props = mount({ task: parked, readyToSubmit: true });
    fireEvent.click(screen.getByRole("button", { name: /I've submitted it/ }));
    expect(props.onApplied).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Fill it again/ }));
    expect(props.onOpenAndFill).toHaveBeenCalled();
  });

  it("stays out of the way when something still needs the user", () => {
    // Needs-you outranks it: an outstanding field is not "everything filled".
    mount({
      task: task({
        applicationInfo: { status: 2, filledFields: [], missingFields: ["Why us?"] },
        fieldReports: [field({ label: "Why us?", outcome: "needs-user", required: true })],
      }),
      readyToSubmit: true,
    });
    expect(screen.queryByText(/Everything we could fill is filled/)).toBeNull();
  });

  it("is absent on a fill that has not finished", () => {
    mount({ task: task({ fieldReports: [field({ label: "Email" })] }) });
    expect(screen.queryByText(/Everything we could fill is filled/)).toBeNull();
  });
});

describe("filling an application already marked as submitted", () => {
  const applied = task({ fieldReports: [field({ label: "Email" })] });

  it("asks first, and says what re-filling costs", () => {
    // It used to happen silently: the finished record reopened while the
    // application stayed marked applied.
    const props = mount({ task: applied, alreadyApplied: true });
    fireEvent.click(screen.getByRole("button", { name: "Re-fill" }));
    expect(props.onOpenAndFill).not.toHaveBeenCalled();
    expect(screen.getByText(/reopens it as unsent/i)).toBeTruthy();
  });

  it("goes ahead when confirmed", () => {
    const props = mount({ task: applied, alreadyApplied: true });
    fireEvent.click(screen.getByRole("button", { name: "Re-fill" }));
    fireEvent.click(screen.getByRole("button", { name: /Fill it again anyway/ }));
    expect(props.onOpenAndFill).toHaveBeenCalled();
  });

  it("backs out cleanly", () => {
    const props = mount({ task: applied, alreadyApplied: true });
    fireEvent.click(screen.getByRole("button", { name: "Re-fill" }));
    fireEvent.click(screen.getByRole("button", { name: /Never mind/ }));
    expect(screen.queryByText(/reopens it as unsent/i)).toBeNull();
    expect(props.onOpenAndFill).not.toHaveBeenCalled();
  });

  it("does not ask on an application that has not been submitted", () => {
    const props = mount({ task: applied });
    fireEvent.click(screen.getByRole("button", { name: "Re-fill" }));
    expect(props.onOpenAndFill).toHaveBeenCalled();
  });
});

describe("what it says after opening the page", () => {
  it("with the extension there, it says the panel is filling it", () => {
    mount({ task: task(), ticketCreated: true, extensionPresent: true });
    expect(screen.getByText(/the browser panel is filling it in/i)).toBeTruthy();
  });

  it("without it, it says what actually happened and how to get the rest", () => {
    // The old copy promised "the Side Panel will pick it up", which was simply
    // false with no extension installed, and mentioned a ticket besides.
    mount({ task: task(), ticketCreated: true, extensionPresent: false });
    expect(screen.getByText(/Install the OfferOS browser extension/i)).toBeTruthy();
    expect(screen.queryByText(/Ticket/i)).toBeNull();
  });
});
