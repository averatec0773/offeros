import { describe, expect, it } from "vitest";
import { findConflicts } from "../constraints";

const NEEDS_SPONSORSHIP = { needsSponsorship: true };
const REMOTE_ONLY = { remoteOnly: true };

describe("findConflicts — sponsorship", () => {
  it("flags a posting that says it will not sponsor, quoting the posting", () => {
    const jd =
      "We are hiring an AI engineer. Please note we are unable to provide visa sponsorship for this role. Apply by Friday.";
    const [conflict] = findConflicts(jd, NEEDS_SPONSORSHIP);
    expect(conflict?.kind).toBe("no-sponsorship");
    expect(conflict?.evidence).toContain("unable to provide visa sponsorship");
  });

  it("catches the other wordings employers actually use", () => {
    for (const jd of [
      "No visa sponsorship is available for this position.",
      "Candidates must be authorized to work without sponsorship.",
      "We do not sponsor employment visas.",
    ]) {
      expect(findConflicts(jd, NEEDS_SPONSORSHIP)).toHaveLength(1);
    }
  });

  it("says nothing when the applicant does not need sponsorship", () => {
    const jd = "We are unable to provide visa sponsorship for this role.";
    expect(findConflicts(jd, {})).toEqual([]);
  });

  it("does not flag a posting that OFFERS sponsorship", () => {
    const jd = "We provide visa sponsorship and relocation support.";
    expect(findConflicts(jd, NEEDS_SPONSORSHIP)).toEqual([]);
  });
});

describe("findConflicts — location", () => {
  it("flags an on-site requirement for a remote-only applicant", () => {
    const jd = "This is a fully on-site role in our New York office.";
    expect(findConflicts(jd, REMOTE_ONLY)[0]?.kind).toBe("onsite-required");
  });

  it("leaves a hybrid or remote posting alone", () => {
    expect(findConflicts("Remote-first team, occasional travel.", REMOTE_ONLY)).toEqual([]);
    expect(findConflicts("Hybrid: two days a week in the office.", REMOTE_ONLY)).toEqual([]);
  });
});

describe("findConflicts — shape", () => {
  it("returns nothing for empty job text rather than guessing", () => {
    expect(findConflicts("", { needsSponsorship: true, remoteOnly: true })).toEqual([]);
  });

  it("reports every conflict, not just the first", () => {
    const jd = "We do not sponsor employment visas. This is a fully on-site role in Boston.";
    expect(findConflicts(jd, { needsSponsorship: true, remoteOnly: true })).toHaveLength(2);
  });

  it("trims a long quote so the reason stays readable", () => {
    const jd = `${"context ".repeat(60)}We do not sponsor employment visas.`;
    const [conflict] = findConflicts(jd, NEEDS_SPONSORSHIP);
    expect(conflict!.evidence.length).toBeLessThanOrEqual(160);
  });
});
