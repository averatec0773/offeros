import { describe, it, expect } from "vitest";
import { profileSkillsInJd, segmentJd, missingFromAnalysis } from "../jd-skills";

/**
 * The zero-cost half of the JD card. It has to be right about two things: not
 * claiming a skill the applicant does not have, and not mangling the text it
 * highlights.
 */

describe("profileSkillsInJd", () => {
  const jd = "We need strong Python and Kubernetes experience, plus C++ for the hot path.";

  it("finds the applicant's own skills named in the description", () => {
    expect(profileSkillsInJd(jd, ["Python", "Kubernetes"])).toEqual(["Python", "Kubernetes"]);
  });

  it("answers in the applicant's spelling, through the shared alias table", () => {
    // The profile says "k8s"; the posting says "Kubernetes". Same skill, and
    // the chip should read the way the user wrote it.
    expect(profileSkillsInJd(jd, ["k8s"])).toEqual(["k8s"]);
  });

  it("does not claim a skill the description never mentions", () => {
    expect(profileSkillsInJd(jd, ["Rust", "Haskell"])).toEqual([]);
  });

  it("never matches a fragment of a longer token", () => {
    // The classic: "C" must not light up inside "C++", and "Java" must not
    // light up inside "JavaScript".
    expect(profileSkillsInJd("We use C++ daily.", ["C"])).toEqual([]);
    expect(profileSkillsInJd("Strong JavaScript required.", ["Java"])).toEqual([]);
    expect(profileSkillsInJd("Strong Java required.", ["Java"])).toEqual(["Java"]);
  });

  it("keeps punctuation-bearing skills distinct", () => {
    expect(profileSkillsInJd("Experience with .NET and C#.", ["C#", ".NET"])).toEqual([
      "C#",
      ".NET",
    ]);
  });

  it("is empty for an empty description", () => {
    expect(profileSkillsInJd("", ["Python"])).toEqual([]);
    expect(profileSkillsInJd("   ", ["Python"])).toEqual([]);
  });
});

describe("segmentJd", () => {
  it("splits the text into plain and highlighted runs, losing nothing", () => {
    const jd = "We need Python and Go.";
    const segments = segmentJd(jd, ["Python"], ["Go"]);
    expect(segments.map((s) => s.text).join("")).toBe(jd);
    expect(segments.find((s) => s.text === "Python")!.kind).toBe("have");
    expect(segments.find((s) => s.text === "Go")!.kind).toBe("missing");
  });

  it("preserves the description exactly, whatever the marks", () => {
    const jd = "Python, python, PYTHON — and Kubernetes.\n\nSecond paragraph.";
    expect(
      segmentJd(jd, ["Python", "Kubernetes"], [])
        .map((s) => s.text)
        .join(""),
    ).toBe(jd);
  });

  it("highlights every occurrence, case-insensitively", () => {
    const segments = segmentJd("Python and python and PYTHON", ["Python"], []);
    expect(segments.filter((s) => s.kind === "have")).toHaveLength(3);
  });

  it("keeps the longest match when two overlap", () => {
    // "Machine Learning" is one highlight, not "Machine" plus "Learning".
    const segments = segmentJd("Machine Learning required", ["Machine Learning", "Machine"], []);
    expect(segments.find((s) => s.kind === "have")!.text).toBe("Machine Learning");
  });

  it("a skill the applicant has is never shown as a gap", () => {
    // Both lists name it; "have" must win, or the card would contradict itself.
    const segments = segmentJd("Python required", ["Python"], ["Python"]);
    expect(segments.find((s) => s.text === "Python")!.kind).toBe("have");
  });

  it("returns nothing for empty text", () => {
    expect(segmentJd("", ["Python"], [])).toEqual([]);
  });

  it("returns one plain run when nothing matches", () => {
    expect(segmentJd("Nothing relevant here.", ["Python"], [])).toEqual([
      { text: "Nothing relevant here.", kind: "plain" },
    ]);
  });
});

describe("missingFromAnalysis", () => {
  it("keeps the gaps the applicant genuinely lacks", () => {
    expect(missingFromAnalysis(["Go", "Kubernetes"], ["Python"])).toEqual(["Go", "Kubernetes"]);
  });

  it("drops a gap the applicant actually has, alias included", () => {
    // The analysis said "Kubernetes"; the profile says "k8s". Not a gap.
    expect(missingFromAnalysis(["Kubernetes", "Go"], ["k8s"])).toEqual(["Go"]);
  });

  it("is empty when there is no analysis yet — it never guesses a requirement", () => {
    expect(missingFromAnalysis([], ["Python"])).toEqual([]);
  });
});

describe("the dot does two jobs", () => {
  it("a sentence-ending period does not hide the skill before it", () => {
    expect(profileSkillsInJd("We need Go.", ["Go"])).toEqual(["Go"]);
    expect(profileSkillsInJd("Experience with C#.", ["C#"])).toEqual(["C#"]);
  });

  it("but a dot inside a name still binds it together", () => {
    // "Node.js" is not a mention of "Node".
    expect(profileSkillsInJd("We use Node.js here.", ["Node"])).toEqual([]);
    expect(profileSkillsInJd("We use Node.js here.", ["Node.js"])).toEqual(["Node.js"]);
  });
});
