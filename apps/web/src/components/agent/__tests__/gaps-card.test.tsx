// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GapsCard } from "../gaps-card";
import type { JdAnalysis } from "@offeros/core";

afterEach(cleanup);

const analysis: JdAnalysis = {
  id: "jd-1",
  applicationId: "app-1",
  summary: "Strong fit for the ML Engineer role at Acme.",
  responsibilities: ["Build and ship ML models"],
  requiredSkills: ["Python"],
  preferredSkills: ["Kubernetes"],
  matchNotes: ["5 years of Python and ML pipeline experience"],
  gaps: ["No stated Kubernetes experience"],
  coverLetterRequirement: "optional",
  createdAt: 1,
};

describe("GapsCard", () => {
  it("renders the summary, match notes and gaps", () => {
    render(<GapsCard analysis={analysis} />);

    expect(screen.getByText(analysis.summary)).toBeTruthy();
    expect(screen.getByText("5 years of Python and ML pipeline experience")).toBeTruthy();
    expect(screen.getByText("No stated Kubernetes experience")).toBeTruthy();
    expect(screen.getByText(/Gaps & risks/i)).toBeTruthy();
  });

  it("omits the strengths/gaps sections when empty", () => {
    render(<GapsCard analysis={{ ...analysis, matchNotes: [], gaps: [] }} />);
    expect(screen.queryByText(/Strengths/i)).toBeNull();
    expect(screen.queryByText(/Gaps & risks/i)).toBeNull();
  });
});
