// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MatchScoreRing } from "../match-score-ring";

afterEach(cleanup);

describe("MatchScoreRing", () => {
  it("rounds a fractional score and labels it for assistive tech", () => {
    render(<MatchScoreRing score={81.6} />);
    expect(screen.getByText("82")).toBeTruthy();
    expect(screen.getByLabelText("Match score 82 percent")).toBeTruthy();
  });

  it("clamps a score above 100 down to 100", () => {
    render(<MatchScoreRing score={140} />);
    expect(screen.getByText("100")).toBeTruthy();
    expect(screen.getByLabelText("Match score 100 percent")).toBeTruthy();
  });

  it("clamps a negative score up to 0", () => {
    render(<MatchScoreRing score={-15} />);
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByLabelText("Match score 0 percent")).toBeTruthy();
  });

  it("sizes the svg from the size prop, defaulting to 44", () => {
    const { container, rerender } = render(<MatchScoreRing score={50} />);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("44");

    rerender(<MatchScoreRing score={50} size={64} />);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("64");
  });
});
