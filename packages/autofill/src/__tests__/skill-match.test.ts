import { describe, expect, it } from "vitest";
import { pickSkillMatch, skillCandidates } from "../skill-match";

describe("pickSkillMatch — verified option selection", () => {
  it("selects the exact normalized match", () => {
    const m = pickSkillMatch(["Linux"], ["Python", "Linux", "CUDA"]);
    expect(m).toEqual({ index: 1, text: "Linux" });
  });

  it("is case- and whitespace-insensitive", () => {
    const m = pickSkillMatch(["c u d a"], ["cuda"]);
    expect(m?.index).toBe(0);
  });

  it("does NOT match 'C' against 'C++' when no exact 'C' option exists", () => {
    // A naive includes()-based click would wrongly tag C++ for skill "C".
    expect(pickSkillMatch(["C"], ["C++", "C#", "Python"])).toBeNull();
  });

  it("keeps C, C++, C# distinct", () => {
    expect(pickSkillMatch(["C++"], ["C", "C++", "C#"])).toEqual({ index: 1, text: "C++" });
    expect(pickSkillMatch(["C#"], ["C", "C++", "C#"])).toEqual({ index: 2, text: "C#" });
    expect(pickSkillMatch(["C"], ["C", "C++", "C#"])).toEqual({ index: 0, text: "C" });
  });

  it("matches when the option carries a parenthetical qualifier", () => {
    const m = pickSkillMatch(["JavaScript"], ["JavaScript (Programming Language)", "Java"]);
    expect(m?.index).toBe(0);
  });

  it("tries every candidate and returns the first that matches an option", () => {
    const m = pickSkillMatch(["JS", "JavaScript"], ["TypeScript", "JavaScript"]);
    expect(m).toEqual({ index: 1, text: "JavaScript" });
  });

  it("returns null when no candidate matches any option", () => {
    expect(pickSkillMatch(["Floating-point arithmetic"], ["C", "Linux"])).toBeNull();
  });
});

describe("skillCandidates — expansion for taxonomy misses", () => {
  it("always includes the original skill first", () => {
    expect(skillCandidates("Rust")[0]).toBe("Rust");
  });

  it("expands common abbreviations to their canonical name", () => {
    expect(skillCandidates("JS")).toContain("JavaScript");
    expect(skillCandidates("Py")).toContain("Python");
  });

  it("returns just the skill when there is no known alias", () => {
    expect(skillCandidates("Kubernetes")).toEqual(["Kubernetes"]);
  });
});
