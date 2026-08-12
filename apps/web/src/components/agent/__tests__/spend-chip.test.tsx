// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SpendChip, SPEND_GLYPH, SPEND_TITLE } from "../spend-chip";
import { FitCard } from "../fit-card";
import { JdCard } from "../jd-card";
import type { FitAnalysis, JobInfo } from "@offeros/core";

/**
 * The promise is that nothing calls a model unless you ask it to. That is only
 * worth something if it is visible at the moment of the click — so the mark is
 * on every button that spends, and the absence of the mark is load-bearing.
 */

afterEach(cleanup);

describe("SpendChip", () => {
  it("carries the glyph and says what it costs", () => {
    render(<SpendChip onClick={vi.fn()} label="Generate" />);
    const button = screen.getByRole("button", { name: /Generate/ });
    expect(button.textContent).toContain(SPEND_GLYPH);
    expect(button.getAttribute("title")).toBe(SPEND_TITLE);
    expect(SPEND_TITLE).toMatch(/your own API key/i);
  });

  it("does not fire while it is already spending", () => {
    const onClick = vi.fn();
    render(<SpendChip onClick={onClick} label="Generate" busy busyLabel="Generating…" />);
    fireEvent.click(screen.getByRole("button", { name: /Generating/ }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

const fit: FitAnalysis = {
  id: "f1",
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

const jobInfo: JobInfo = { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" };

describe("the mark is where the money is", () => {
  it("fit recompute is marked", () => {
    render(<FitCard fit={fit} onRecompute={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Recompute/ }).getAttribute("title")).toBe(
      SPEND_TITLE,
    );
  });

  it("the AI reading is marked", () => {
    render(
      <JdCard
        jobInfo={jobInfo}
        jdText="We need Python."
        analysis={null}
        profileSkills={[]}
        onAnalyze={vi.fn()}
        onSaveJdText={vi.fn()}
        onCheckPosting={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /AI reading/ }).getAttribute("title")).toBe(
      SPEND_TITLE,
    );
  });

  it("and NOT on the free ways of getting a description", () => {
    // The contrast is the point: pasting and fetching cost nothing, so they
    // must not carry the same warning as the button that bills you.
    render(
      <JdCard
        jobInfo={jobInfo}
        jdText=""
        analysis={null}
        profileSkills={[]}
        onAnalyze={vi.fn()}
        onSaveJdText={vi.fn()}
        onCheckPosting={vi.fn()}
      />,
    );
    for (const name of ["Paste it", "Fetch it from the posting"]) {
      const button = screen.getByRole("button", { name });
      expect(button.getAttribute("title")).toBeNull();
      expect(button.textContent).not.toContain(SPEND_GLYPH);
    }
  });
});
