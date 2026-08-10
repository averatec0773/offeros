import { describe, expect, it } from "vitest";
import { atsFromUrl, computeFillStats, type ApplicationFill } from "../fill-stats";
import type { DiagnosableField } from "../diagnose";

const field = (
  outcome: string,
  reason: string,
  required = false,
  source = "none",
): DiagnosableField => ({ label: "q", outcome, reason, source, required });

const OPEN = "no classifier or answer-bank match, open-ended question";
const UNKNOWN = "no classifier match → left unknown";
const UPLOAD = "file input → always manual upload, left needs-answer";
const GUARD = "a guard refused to answer for you";

describe("computeFillStats", () => {
  /**
   * The headline must not count a guard refusing, or a file only a person can
   * upload, as a failure — otherwise the fastest way to raise the number is to
   * weaken a guard, which is the worst thing this system could optimise for.
   */
  it("leaves guard refusals and manual uploads out of the denominator", () => {
    const stats = computeFillStats([
      {
        applyLink: "https://jobs.ashbyhq.com/acme/1/application",
        fields: [
          field("filled", "profile"),
          field("filled", "profile"),
          field("needs-user", GUARD, true),
          field("needs-user", UPLOAD),
        ],
      },
    ]);
    // Four fields seen, two of them not the engine's to fill.
    expect(stats.fields).toBe(4);
    expect(stats.expected).toBe(2);
    expect(stats.filled).toBe(2);
    expect(stats.coverage).toBe(100);
  });

  it("counts a question with no saved answer against coverage", () => {
    // This one IS the engine's to improve, so it must lower the score.
    const stats = computeFillStats([
      { fields: [field("filled", "profile"), field("needs-user", OPEN, true)] },
    ]);
    expect(stats.expected).toBe(2);
    expect(stats.coverage).toBe(50);
    expect(stats.causes[0]).toEqual({ cause: "needs-your-answer", fields: 1, required: 1 });
  });

  it("does not count skipped controls as anything", () => {
    // Skipped is the engine deciding a control is not a question.
    const stats = computeFillStats([
      { fields: [field("filled", "profile"), field("skipped", "not a question")] },
    ]);
    expect(stats.skipped).toBe(1);
    expect(stats.expected).toBe(1);
    expect(stats.coverage).toBe(100);
  });

  it("splits the score by platform", () => {
    const stats = computeFillStats([
      {
        applyLink: "https://job-boards.greenhouse.io/acme/jobs/1",
        fields: [field("filled", "profile"), field("needs-user", UNKNOWN)],
      },
      {
        applyLink: "https://jobs.ashbyhq.com/acme/1/application",
        fields: [field("filled", "profile"), field("filled", "profile")],
      },
    ]);
    const byName = Object.fromEntries(stats.byAts.map((a) => [a.ats, a]));
    expect(byName.Greenhouse).toMatchObject({ applications: 1, expected: 2, filled: 1 });
    expect(byName.Ashby).toMatchObject({ applications: 1, expected: 2, filled: 2 });
  });

  it("ignores applications that have never run a fill", () => {
    const empty: ApplicationFill = { fields: [] };
    const stats = computeFillStats([empty, { fields: [field("filled", "profile")] }]);
    expect(stats.applications).toBe(1);
  });

  /**
   * The names under a cause are capped for readability. Reading that list's
   * length as the count under-reports, silently — real data caught it:
   * eighteen unrecognised fields were being totalled as eight, and the
   * breakdown stopped adding up to the gap.
   */
  it("counts every field under a cause, not just the ones it names", () => {
    const twenty = Array.from({ length: 20 }, () => field("needs-user", UNKNOWN));
    const stats = computeFillStats([{ fields: [field("filled", "profile"), ...twenty] }]);
    expect(stats.causes[0]).toEqual({ cause: "not-recognised", fields: 20, required: 0 });
    // And the breakdown reconciles with the gap.
    const gap = stats.expected - stats.filled;
    expect(stats.causes.reduce((n, c) => n + c.fields, 0)).toBe(gap);
  });

  it("reports zero rather than dividing by nothing", () => {
    expect(computeFillStats([]).coverage).toBe(0);
    expect(computeFillStats([{ fields: [field("needs-user", UPLOAD)] }]).coverage).toBe(0);
  });
});

describe("atsFromUrl", () => {
  it("names the platforms the project supports", () => {
    expect(atsFromUrl("https://job-boards.greenhouse.io/x/jobs/1")).toBe("Greenhouse");
    expect(atsFromUrl("https://jobs.lever.co/x/1")).toBe("Lever");
    expect(atsFromUrl("https://jobs.ashbyhq.com/x/1")).toBe("Ashby");
    expect(atsFromUrl("https://nvidia.wd5.myworkdayjobs.com/x")).toBe("Workday");
    expect(atsFromUrl("https://careers-x.icims.com/jobs/1")).toBe("iCIMS");
  });

  it("buckets anything else rather than making a row per employer", () => {
    // One row per careers site would bury the rows that matter.
    expect(atsFromUrl("https://careers.acme.com/apply")).toBe("Other");
    expect(atsFromUrl("not a url")).toBe("Other");
    expect(atsFromUrl(undefined)).toBe("Other");
  });
});
