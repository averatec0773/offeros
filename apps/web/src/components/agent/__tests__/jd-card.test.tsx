// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { JdAnalysis, JobInfo } from "@offeros/core";
import { JdCard } from "../jd-card";

/**
 * The JD card's contract: the free layer always works and never asks for
 * anything, and the paid layer is only ever entered by pressing a marked
 * button — then stored, so it is paid for once.
 */

afterEach(cleanup);

const jobInfo: JobInfo = {
  jobId: "j1",
  jobTitle: "ML Engineer",
  companyName: "Acme",
  jobLocation: "Austin, TX",
  salaryDesc: "$180k - $200k/yr",
  publishTimeDesc: "3 days ago",
  jobSeniority: "Senior",
};

const analysis: JdAnalysis = {
  id: "jd-1",
  applicationId: "app-1",
  summary: "A senior ML role owning production pipelines.",
  responsibilities: ["Own the training pipeline"],
  requiredSkills: ["Python", "Go"],
  preferredSkills: ["Kubernetes"],
  matchNotes: [],
  gaps: ["Go"],
  coverLetterRequirement: "optional",
  createdAt: 1,
};

function mount(over: Partial<Parameters<typeof JdCard>[0]> = {}) {
  const props = {
    jobInfo,
    jdText: "We need Python and Go for the pipeline.",
    analysis: null,
    profileSkills: ["Python"],
    onAnalyze: vi.fn(),
    onSaveJdText: vi.fn(),
    onCheckPosting: vi.fn(),
    ...over,
  };
  render(<JdCard {...props} />);
  return props;
}

describe("the free layer", () => {
  it("shows the posting's own text", () => {
    mount();
    expect(screen.getByText(/for the pipeline/)).toBeTruthy();
  });

  it("uses the job meta it already has, money first", () => {
    mount();
    expect(screen.getByText("$180k - $200k/yr")).toBeTruthy();
    expect(screen.getByText("Austin, TX")).toBeTruthy();
    expect(screen.getByText("3 days ago")).toBeTruthy();
    expect(screen.getByText("Senior")).toBeTruthy();
  });

  it("highlights a skill the applicant has, in the text and as a chip", () => {
    mount();
    const marks = document.querySelectorAll('mark[data-skill="have"]');
    expect(marks.length).toBeGreaterThan(0);
    expect([...marks].some((m) => m.textContent === "Python")).toBe(true);
  });

  it("marks nothing as missing until an analysis says what is required", () => {
    // Knowing "Go" appears is not knowing it is required — the free layer
    // stays quiet rather than guessing.
    mount();
    expect(document.querySelectorAll('mark[data-skill="missing"]')).toHaveLength(0);
  });

  it("marks the gaps once an analysis exists", () => {
    mount({ analysis });
    const missing = document.querySelectorAll('mark[data-skill="missing"]');
    expect([...missing].some((m) => m.textContent === "Go")).toBe(true);
  });

  it("collapses a long posting behind an expander, and expands it", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Line ${i}`).join("\n");
    mount({ jdText: long });
    expect(screen.queryByText(/Line 39/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show the full posting \(40 lines\)/ }));
    expect(screen.getByText(/Line 39/)).toBeTruthy();
  });
});

describe("no description yet", () => {
  it("offers two free ways out and says they are free", () => {
    const props = mount({ jdText: "" });
    expect(screen.getByText(/No description saved/)).toBeTruthy();
    expect(screen.getByText(/neither calls your AI provider/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fetch it from the posting" }));
    expect(props.onCheckPosting).toHaveBeenCalled();
  });

  it("saves a pasted description", () => {
    const props = mount({ jdText: "" });
    fireEvent.click(screen.getByRole("button", { name: "Paste it" }));
    fireEvent.change(screen.getByLabelText("Job description"), {
      target: { value: "  Pasted posting body.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onSaveJdText).toHaveBeenCalledWith("  Pasted posting body.  ");
  });

  it("offers no AI reading with nothing to read", () => {
    mount({ jdText: "" });
    expect(screen.queryByRole("button", { name: /AI reading/ })).toBeNull();
  });
});

describe("the paid layer", () => {
  it("is only entered by pressing the button, and the button is marked as spending", () => {
    const props = mount();
    const button = screen.getByRole("button", { name: /AI reading/ });
    expect(button.getAttribute("title")).toMatch(/your own API key/i);
    expect(props.onAnalyze).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(props.onAnalyze).toHaveBeenCalledTimes(1);
  });

  it("reuses a stored reading instead of asking to pay again", () => {
    mount({ analysis });
    // The button becomes a re-read, and the reading is already available.
    expect(screen.getByRole("button", { name: /Re-read/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "AI reading" }));
    expect(screen.getByText("A senior ML role owning production pipelines.")).toBeTruthy();
    expect(screen.getByText("· Own the training pipeline")).toBeTruthy();
  });

  it("keeps the posting and the reading as peers, one click apart", () => {
    mount({ analysis });
    fireEvent.click(screen.getByRole("tab", { name: "AI reading" }));
    expect(screen.queryByText(/for the pipeline/)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Posting" }));
    expect(screen.getByText(/for the pipeline/)).toBeTruthy();
  });

  it("shows no view toggle before there is anything to toggle to", () => {
    mount();
    expect(screen.queryByRole("tab", { name: "AI reading" })).toBeNull();
  });
});
