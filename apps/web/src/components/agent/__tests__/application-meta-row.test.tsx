// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { JdAnalysis } from "@offeros/core";
import { ApplicationMetaRow, isLikelyStale } from "../application-meta-row";

/**
 * The rule for this row: show what we know, say plainly what we do not, and
 * never compute a date nobody gave us.
 */

afterEach(cleanup);

const DAY = 86_400_000;
const now = Date.now();

const analysisWith = (
  deadline: JdAnalysis["jobFacts"] extends undefined
    ? never
    : {
        state: "stated" | "denied" | "not-mentioned";
        detail: string;
      },
): JdAnalysis => ({
  id: "jd-1",
  applicationId: "app-1",
  summary: "",
  responsibilities: [],
  requiredSkills: [],
  preferredSkills: [],
  matchNotes: [],
  gaps: [],
  coverLetterRequirement: "optional",
  jobFacts: {
    salary: { state: "not-mentioned", detail: "" },
    sponsorship: { state: "not-mentioned", detail: "" },
    remote: { state: "not-mentioned", detail: "" },
    deadline,
  },
  createdAt: 1,
});

describe("what it shows", () => {
  it("always says when the application was added", () => {
    render(<ApplicationMetaRow createdAt={now - 3 * DAY} analysis={null} />);
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.getByText("3d ago")).toBeTruthy();
  });

  it("shows the posting's own freshness phrase verbatim", () => {
    // It is scraped descriptive text; parsing it into a date would be a guess.
    render(
      <ApplicationMetaRow createdAt={now} publishTimeDesc="Posted last Tuesday" analysis={null} />,
    );
    expect(screen.getByText("Posted last Tuesday")).toBeTruthy();
  });

  it("omits applied and checked entirely when neither happened", () => {
    render(<ApplicationMetaRow createdAt={now} analysis={null} />);
    expect(screen.queryByText("Applied")).toBeNull();
    expect(screen.queryByText("Checked")).toBeNull();
  });

  it("shows them once they have", () => {
    render(
      <ApplicationMetaRow
        createdAt={now - 10 * DAY}
        appliedAt={now - 2 * DAY}
        lastCheckedAt={now - 3600_000}
        analysis={null}
      />,
    );
    expect(screen.getByText("Applied")).toBeTruthy();
    expect(screen.getByText("2d ago")).toBeTruthy();
    expect(screen.getByText("Checked")).toBeTruthy();
  });
});

describe("the deadline", () => {
  it("shows only what the posting stated", () => {
    render(
      <ApplicationMetaRow
        createdAt={now}
        analysis={analysisWith({ state: "stated", detail: "Apply by 30 August" })}
      />,
    );
    expect(screen.getByText("Apply by 30 August")).toBeTruthy();
  });

  it("says 'not stated' rather than inventing one", () => {
    render(
      <ApplicationMetaRow
        createdAt={now}
        analysis={analysisWith({ state: "not-mentioned", detail: "" })}
      />,
    );
    expect(screen.getByText("not stated")).toBeTruthy();
  });

  it("says nothing at all before the posting has been read", () => {
    render(<ApplicationMetaRow createdAt={now} analysis={null} />);
    expect(screen.queryByText("Deadline")).toBeNull();
  });
});

describe("the staleness note", () => {
  it("appears for a posting that has plainly been up a while", () => {
    render(<ApplicationMetaRow createdAt={now} publishTimeDesc="2 months ago" analysis={null} />);
    expect(screen.getByText(/been up a while/)).toBeTruthy();
  });

  it("stays quiet for a fresh one", () => {
    render(<ApplicationMetaRow createdAt={now} publishTimeDesc="3 days ago" analysis={null} />);
    expect(screen.queryByText(/been up a while/)).toBeNull();
  });

  it("reads only phrases it can read confidently", () => {
    // A wrong "this may be stale" is worse than a missing one.
    expect(isLikelyStale("2 months ago")).toBe(true);
    expect(isLikelyStale("45 days ago")).toBe(true);
    expect(isLikelyStale("3 days ago")).toBe(false);
    expect(isLikelyStale("Posted recently")).toBe(false);
    expect(isLikelyStale(undefined)).toBe(false);
  });
});
