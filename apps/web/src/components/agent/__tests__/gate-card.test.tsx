// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { GateCard } from "../gate-card";
import type { AgentTask } from "@offeros/core";

afterEach(cleanup);

const task: AgentTask = {
  id: "t1",
  applicationId: "app-1",
  status: "awaiting_user",
  coverLetterRequirement: "unknown",
  skippedCoverLetter: false,
  step: 1,
  fieldReports: [],
  createdAt: 1,
  updatedAt: 2,
};

describe("GateCard", () => {
  it("renders the confirm-resume title, rationale, and fires Approve/Tweak on click", () => {
    const onApprove = vi.fn();
    const onTweak = vi.fn();
    render(
      <GateCard
        task={task}
        kind="confirm-resume"
        rationale="Emphasized the ML pipeline work from your JD's core ask."
        onApprove={onApprove}
        onTweak={onTweak}
      />,
    );

    expect(screen.getByText("Your tailored résumé is ready")).toBeTruthy();
    expect(screen.getByText(/Emphasized the ML pipeline work/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "I Want To Tweak It" }));
    expect(onTweak).toHaveBeenCalledTimes(1);

    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Generate Cover Letter" })).toBeNull();
  });

  it("renders the confirm-cover-letter title with the same Approve/Tweak actions", () => {
    render(<GateCard task={task} kind="confirm-cover-letter" />);
    expect(screen.getByText("Your cover letter is ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I Want To Tweak It" })).toBeTruthy();
  });

  it("renders the choice title with Skip/Generate actions instead of Approve/Tweak", () => {
    const onSkip = vi.fn();
    const onGenerate = vi.fn();
    render(<GateCard task={task} kind="choice" onSkip={onSkip} onGenerate={onGenerate} />);

    expect(screen.getByText("Want a cover letter for this one?")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "I Want To Tweak It" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onSkip).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Generate Cover Letter" }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("omits the rationale paragraph when none is given", () => {
    const { container } = render(<GateCard task={task} kind="confirm-resume" />);
    expect(container.querySelector("p")).toBeNull();
  });

  it("tags the card with the task id for scoping in a list", () => {
    const { container } = render(<GateCard task={task} kind="confirm-resume" />);
    expect(container.querySelector('[data-task-id="t1"]')).toBeTruthy();
  });
});
