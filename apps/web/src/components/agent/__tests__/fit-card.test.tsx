// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FitCard } from "../fit-card";
import type { FitAnalysis } from "@offeros/core";

afterEach(cleanup);

const fit: FitAnalysis = {
  id: "fit-1",
  applicationId: "app-1",
  version: 1,
  overall: 82,
  label: "Strong match",
  subScores: { experience: 80, skills: 85, education: 70 },
  whyMatch: "Solid Python and ML background lines up with the JD's core requirements.",
  alignedSkills: [{ skill: "Python", evidence: "Shipped ML systems for 5 years" }],
  notAlignedSkills: [{ skill: "Kubernetes", advice: "Take a hands-on k8s course" }],
  createdAt: 1,
};

describe("FitCard", () => {
  it("renders every section from the fixture", () => {
    render(<FitCard fit={fit} />);

    expect(screen.getByText("82")).toBeTruthy();
    expect(screen.getByText("Strong match")).toBeTruthy();

    expect(screen.getByText("Experience")).toBeTruthy();
    expect(screen.getByText("Skills")).toBeTruthy();
    expect(screen.getByText("Education")).toBeTruthy();

    expect(screen.getByText(fit.whyMatch)).toBeTruthy();

    // Skills are chips now: the verdict is glanceable, and the evidence or
    // advice that used to be a sentence under each one is on hover, so the
    // claim stays checkable without turning the card into two paragraphs.
    const aligned = screen.getByText("Python");
    expect(aligned.getAttribute("data-fit")).toBe("aligned");
    expect(aligned.getAttribute("title")).toMatch(/Shipped ML systems/);

    const gap = screen.getByText("Kubernetes");
    expect(gap.getAttribute("data-fit")).toBe("not-aligned");
    expect(gap.getAttribute("title")).toMatch(/hands-on k8s course/);
  });

  it("omits the aligned/not-aligned sections when empty", () => {
    render(<FitCard fit={{ ...fit, alignedSkills: [], notAlignedSkills: [] }} />);
    expect(screen.queryByText("Python")).toBeNull();
    expect(screen.queryByText("Kubernetes")).toBeNull();
  });

  it("fires onRecompute when the button is clicked", () => {
    const onRecompute = vi.fn();
    render(<FitCard fit={fit} onRecompute={onRecompute} />);

    fireEvent.click(screen.getByText(/Recompute/i));
    expect(onRecompute).toHaveBeenCalledTimes(1);
  });

  it("disables the button and shows busy copy while recomputing", () => {
    render(<FitCard fit={fit} onRecompute={() => {}} busy />);

    const button = screen.getByRole("button", { name: /Recomputing/i });
    expect(button).toBeTruthy();
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("shows connect-provider copy with a Settings → AI link when llmError is set", () => {
    render(<FitCard fit={fit} llmError />);

    expect(screen.getByText(/Connect your AI provider to start/i)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Settings → AI" });
    expect(link.getAttribute("href")).toBe("/settings/ai");
  });

  it("omits the connect-provider copy when llmError is not set", () => {
    render(<FitCard fit={fit} />);
    expect(screen.queryByText(/Connect your AI provider to start/i)).toBeNull();
  });
});
