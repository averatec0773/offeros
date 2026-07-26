// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { StepTimeline } from "../step-timeline";
import { PIPELINE_STEPS, type AgentTask } from "@offeros/core";

afterEach(cleanup);

describe("StepTimeline", () => {
  it("shows every milestone as done and none as in progress when step = 7", () => {
    const task: AgentTask = {
      id: "t1",
      applicationId: "app-1",
      status: "done",
      coverLetterRequirement: "unknown",
      skippedCoverLetter: false,
      step: 7,
      fieldReports: [],
      createdAt: 1,
      updatedAt: 2,
    };
    render(<StepTimeline task={task} />);

    for (const step of PIPELINE_STEPS) {
      const label = screen.getByText(step.label);
      const row = label.closest("li");
      expect(row?.querySelector(".text-brand")).toBeTruthy();
    }
    expect(screen.queryByText("In progress")).toBeNull();
  });

  it("marks Submit Application as current and the six before it as done when step = 6", () => {
    const task: AgentTask = {
      id: "t1",
      applicationId: "app-1",
      status: "awaiting_user",
      coverLetterRequirement: "unknown",
      skippedCoverLetter: false,
      step: 6,
      fieldReports: [],
      createdAt: 1,
      updatedAt: 2,
    };
    render(<StepTimeline task={task} />);

    const submitLabel = screen.getByText("Submit Application");
    const submitRow = submitLabel.closest("li");
    expect(submitRow?.textContent).toContain("In progress");

    const doneSteps = PIPELINE_STEPS.slice(0, 6);
    for (const step of doneSteps) {
      const row = screen.getByText(step.label).closest("li");
      expect(row?.querySelector(".text-brand")).toBeTruthy();
      expect(row?.textContent).not.toContain("In progress");
    }
  });

  it('shows "Queued" instead of "In progress" for the current step while the task is queued', () => {
    const task: AgentTask = {
      id: "t1",
      applicationId: "app-1",
      status: "queued",
      coverLetterRequirement: "unknown",
      skippedCoverLetter: false,
      step: 0,
      fieldReports: [],
      createdAt: 1,
      updatedAt: 2,
    };
    render(<StepTimeline task={task} />);

    const currentLabel = screen.getByText(PIPELINE_STEPS[0]!.label);
    const row = currentLabel.closest("li");
    expect(row?.textContent).toContain("Queued");
    expect(row?.textContent).not.toContain("In progress");
    expect(screen.queryByText("In progress")).toBeNull();
  });

  it('shows "Failed" instead of "In progress" for the current step when the task has failed', () => {
    const task: AgentTask = {
      id: "t1",
      applicationId: "app-1",
      status: "failed",
      coverLetterRequirement: "unknown",
      skippedCoverLetter: false,
      step: 0,
      fieldReports: [],
      createdAt: 1,
      updatedAt: 2,
    };
    render(<StepTimeline task={task} />);

    const currentLabel = screen.getByText(PIPELINE_STEPS[0]!.label);
    const row = currentLabel.closest("li");
    expect(row?.textContent).toContain("Failed");
    expect(row?.textContent).not.toContain("In progress");
  });

  it('shows "Paused" instead of "In progress" for the current step when the task is paused', () => {
    const task: AgentTask = {
      id: "t1",
      applicationId: "app-1",
      status: "paused",
      coverLetterRequirement: "unknown",
      skippedCoverLetter: false,
      step: 0,
      fieldReports: [],
      createdAt: 1,
      updatedAt: 2,
    };
    render(<StepTimeline task={task} />);

    const currentLabel = screen.getByText(PIPELINE_STEPS[0]!.label);
    const row = currentLabel.closest("li");
    expect(row?.textContent).toContain("Paused");
    expect(row?.textContent).not.toContain("In progress");
  });

  it('still shows "In progress" for the current step while the task is running (regression)', () => {
    const task: AgentTask = {
      id: "t1",
      applicationId: "app-1",
      status: "running",
      coverLetterRequirement: "unknown",
      skippedCoverLetter: false,
      step: 0,
      fieldReports: [],
      createdAt: 1,
      updatedAt: 2,
    };
    render(<StepTimeline task={task} />);

    const currentLabel = screen.getByText(PIPELINE_STEPS[0]!.label);
    const row = currentLabel.closest("li");
    expect(row?.textContent).toContain("In progress");
    expect(screen.queryByText("Queued")).toBeNull();
  });

  it("renders the ActionRequiredCard when applicationInfo.status is 2 at the fill-form step", () => {
    const task: AgentTask = {
      id: "t1",
      applicationId: "app-1",
      status: "awaiting_user",
      coverLetterRequirement: "unknown",
      skippedCoverLetter: false,
      step: 5,
      fieldReports: [],
      applicationInfo: { status: 2, filledFields: [], missingFields: ["LinkedIn Profile"] },
      createdAt: 1,
      updatedAt: 2,
    };
    render(<StepTimeline task={task} />);

    expect(screen.getAllByText(/Action Required/i).length).toBeGreaterThan(0);
    expect(screen.getByText("LinkedIn Profile")).toBeTruthy();
  });
});
