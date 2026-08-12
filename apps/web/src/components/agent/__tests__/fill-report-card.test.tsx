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
  it("renders filled rows with source and value", () => {
    render(<FillReportCard reports={reports} />);

    expect(screen.getByText("Full name")).toBeTruthy();
    // The source is shown in words, not as the engine's own slug.
    expect(screen.getByText(/from your profile/)).toBeTruthy();
    expect(screen.getByText(/Jordan Rivera/)).toBeTruthy();
  });

  /**
   * What did not fill is grouped by cause rather than listed row by row with
   * the engine's own wording. Eighteen rows on a real form is a wall; the
   * causes are a to-do list, and they come from the same `diagnoseFill` the
   * agent reads — so the card and the chat cannot disagree about one fill.
   */
  it("groups unfilled fields under a cause, not under their raw reason", () => {
    render(<FillReportCard reports={reports} />);

    expect(screen.getByText(/Waiting on an answer from you/)).toBeTruthy();
    // The field is named; the developer-facing reason string is not shown.
    expect(screen.getByText("Visa sponsorship required?")).toBeTruthy();
    expect(screen.queryByText(/no matching answer in the answer bank/)).toBeNull();
  });

  it("does not count a skipped control as something needing attention", () => {
    // A skipped control is the engine deciding it is not a question. Counting
    // it as a failure made a form that behaved correctly look broken.
    const withSkipped: FieldReport[] = [
      ...reports,
      {
        fieldId: "f-search",
        label: "Search",
        classifiedType: "unknown",
        status: "unknown",
        source: "none",
        reason: "not a question",
        outcome: "skipped",
        required: false,
      },
    ];
    render(<FillReportCard reports={withSkipped} />);
    expect(screen.queryByText("Search")).toBeNull();
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

  it("renders resume-file and cover-letter-file sources as 'attached: <filename>'", () => {
    const attached: FieldReport[] = [
      {
        fieldId: "f-resume",
        label: "Resume/CV",
        classifiedType: "resume",
        status: "needs-answer",
        value: "Jordan_Rivera_Resume.pdf",
        source: "resume-file",
        reason: "attached the tailored résumé PDF",
        outcome: "filled",
        required: true,
      },
      {
        fieldId: "f-cover",
        label: "Cover Letter",
        classifiedType: "coverLetter",
        status: "needs-answer",
        value: "Cover_Letter.pdf",
        source: "cover-letter-file",
        reason: "attached the cover letter PDF",
        outcome: "filled",
        required: false,
      },
    ];
    render(<FillReportCard reports={attached} />);

    const resumeLabel = screen.getByText("Resume/CV");
    expect(resumeLabel.parentElement?.textContent).toBe(
      "Resume/CV — attached: Jordan_Rivera_Resume.pdf",
    );

    const coverLabel = screen.getByText("Cover Letter");
    expect(coverLabel.parentElement?.textContent).toBe("Cover Letter — attached: Cover_Letter.pdf");
  });
});
