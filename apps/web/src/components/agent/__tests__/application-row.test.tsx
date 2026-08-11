// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ApplicationRow, fitLabelFor } from "../application-row";
import type { Application, PipelineTask, FitAnalysis } from "@offeros/core";

afterEach(cleanup);

const application: Application = {
  id: "app-1",
  jobInfo: { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver", displayScore: 61 },
  status: "applying",
  createdAt: 1,
  updatedAt: 2,
};

describe("ApplicationRow", () => {
  /**
   * The row says what happened to the application, not which pipeline step it
   * stopped at. After a few dozen applications "step 6 of 7" tells you nothing
   * you can act on; "filled 2/3, 1 needs you" is the thing being remembered.
   */
  it("renders the role, company and what the last fill did", () => {
    const task: PipelineTask = {
      id: "t1",
      applicationId: "app-1",
      status: "awaiting_user",
      coverLetterRequirement: "unknown",
      skippedCoverLetter: false,
      step: 6,
      fieldReports: [
        {
          fieldId: "a",
          label: "Name",
          classifiedType: "fullName",
          status: "filled",
          source: "personal",
          reason: "",
          outcome: "filled",
          required: true,
        },
        {
          fieldId: "b",
          label: "Why us?",
          classifiedType: "unknown",
          status: "needs-user",
          source: "none",
          reason: "",
          outcome: "needs-user",
          required: true,
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    };
    render(<ApplicationRow application={application} task={task} />);
    expect(screen.getByText("Filled 1/2 · 1 need you")).toBeTruthy();
    expect(screen.getByText("GenAI Engineer")).toBeTruthy();
    expect(screen.getByText(/Evolver/)).toBeTruthy();
  });

  it("surfaces the action-required state", () => {
    const task: PipelineTask = {
      id: "t1",
      applicationId: "app-1",
      status: "awaiting_user",
      coverLetterRequirement: "unknown",
      skippedCoverLetter: false,
      step: 6,
      fieldReports: [],
      applicationInfo: { status: 2, filledFields: [], missingFields: ["LinkedIn Profile"] },
      createdAt: 1,
      updatedAt: 2,
    };
    render(<ApplicationRow application={application} task={task} />);
    expect(screen.getByText(/Action Required/i)).toBeTruthy();
    // The badge must not hide what happened — it answers a different question.
    expect(screen.getByText("Not started")).toBeTruthy();
  });

  /**
   * Asking hands off to the agent page carrying this job, rather than opening a
   * second chat inside the row. One conversation lives in one place; the chip
   * there shows which job came along and can be taken off.
   */
  it("sends Ask to the agent page carrying this application", () => {
    render(<ApplicationRow application={application} task={null} />);
    const ask = screen.getByRole("link", { name: /Ask about GenAI Engineer/i });
    expect(ask.getAttribute("href")).toBe("/agent?application=app-1");
    // No chat mounted in the row any more.
    expect(screen.queryByLabelText("Ask about this application")).toBeNull();
  });

  it("keeps the Ask control out of the row link", () => {
    // Nesting it inside the row's own link would make it neither
    // keyboard-navigable nor clickable the way either one promises.
    render(<ApplicationRow application={application} task={null} />);
    const ask = screen.getByRole("link", { name: /Ask about/i });
    expect(ask.closest('a[href="/applications/app-1"]')).toBeNull();
  });

  it("renders without a task", () => {
    render(<ApplicationRow application={application} task={null} />);
    expect(screen.getByText("GenAI Engineer")).toBeTruthy();
    expect(screen.getByText(/Not started/i)).toBeTruthy();
  });

  it("omits the fit badge when no fit analysis exists", () => {
    render(<ApplicationRow application={application} task={null} fit={null} />);
    expect(screen.queryByTestId("fit-badge")).toBeNull();
  });

  it("shows the fit badge when a fit analysis exists", () => {
    const fit: FitAnalysis = {
      id: "fit-1",
      applicationId: "app-1",
      version: 1,
      overall: 82,
      label: "Strong match",
      subScores: { experience: 80, skills: 85, education: 70 },
      whyMatch: "",
      alignedSkills: [],
      notAlignedSkills: [],
      createdAt: 1,
    };
    render(<ApplicationRow application={application} task={null} fit={fit} />);
    expect(screen.getByText("82%")).toBeTruthy();
  });
});

describe("fitLabelFor", () => {
  it("labels thresholds as STRONG/GOOD MATCH tiers", () => {
    expect(fitLabelFor(90)).toBe("Strong match");
    expect(fitLabelFor(85)).toBe("Strong match");
    expect(fitLabelFor(75)).toBe("Good match");
    expect(fitLabelFor(70)).toBe("Good match");
    expect(fitLabelFor(50)).toBe("Needs work");
  });
});
