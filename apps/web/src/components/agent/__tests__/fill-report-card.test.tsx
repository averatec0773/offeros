// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FillReportCard } from "../fill-report-card";
import type { FieldReport } from "@offeros/core";

afterEach(cleanup);

const reports: FieldReport[] = [
  {
    fieldId: "f-name",
    label: "Full name",
    classifiedType: "fullName",
    status: "filled",
    value: "Jordan Rivera",
    source: "personal",
    reason: "matched personal.name",
    outcome: "filled",
    required: true,
  },
  {
    fieldId: "f-visa",
    label: "Visa sponsorship required?",
    classifiedType: "unknown",
    status: "needs-user",
    source: "none",
    reason: "no matching answer in the answer bank",
    outcome: "needs-user",
    required: true,
  },
];

describe("FillReportCard", () => {
  it("renders filled rows with source/value and missing rows with reasons", () => {
    render(<FillReportCard reports={reports} />);

    expect(screen.getByText("Full name")).toBeTruthy();
    expect(screen.getByText(/personal/)).toBeTruthy();
    expect(screen.getByText(/Jordan Rivera/)).toBeTruthy();

    expect(screen.getByText("Visa sponsorship required?")).toBeTruthy();
    expect(screen.getByText(/no matching answer in the answer bank/)).toBeTruthy();
  });

  it("renders nothing for an empty report list", () => {
    const { container } = render(<FillReportCard reports={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a filled row with source "none" without a dash-suffix, and with a value as Label: value', () => {
    const resolved: FieldReport[] = [
      {
        fieldId: "f-eeo",
        label: "Race/ethnicity",
        classifiedType: "unknown",
        status: "filled",
        source: "none",
        reason: "",
        outcome: "filled",
        required: true,
      },
      {
        fieldId: "f-visa2",
        label: "Visa sponsorship required?",
        classifiedType: "unknown",
        status: "filled",
        value: "No",
        source: "none",
        reason: "",
        outcome: "filled",
        required: true,
      },
    ];
    render(<FillReportCard reports={resolved} />);

    const noValueLabel = screen.getByText("Race/ethnicity");
    expect(noValueLabel.parentElement?.textContent).toBe("Race/ethnicity");

    const valueLabel = screen.getByText("Visa sponsorship required?");
    expect(valueLabel.parentElement?.textContent).toBe("Visa sponsorship required?: No");
  });
});
