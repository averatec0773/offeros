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

    expect(screen.getByText("Python")).toBeTruthy();
    expect(screen.getByText(/Shipped ML systems/)).toBeTruthy();

    expect(screen.getByText("Kubernetes")).toBeTruthy();
    expect(screen.getByText(/hands-on k8s course/)).toBeTruthy();
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
});
