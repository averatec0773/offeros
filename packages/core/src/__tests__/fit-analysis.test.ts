import { describe, it, expect } from "vitest";
import { fitAnalysisSchema } from "../fit";

function validFit() {
  return {
    id: "fit-1",
    applicationId: "app-1",
    overall: 72,
    label: "Strong match",
    subScores: { experience: 80, skills: 70, education: 60 },
    whyMatch: "Solid overlap with required skills.",
    alignedSkills: [{ skill: "TypeScript", evidence: "3 years professional use" }],
    notAlignedSkills: [{ skill: "Go", advice: "Consider a small side project." }],
    createdAt: 1,
  };
}

describe("fitAnalysisSchema", () => {
  it("round-trips a fully-populated valid analysis", () => {
    const parsed = fitAnalysisSchema.parse(validFit());
    expect(parsed.overall).toBe(72);
    expect(parsed.version).toBe(1);
    expect(parsed.subScores).toEqual({ experience: 80, skills: 70, education: 60 });
    expect(parsed.alignedSkills).toEqual([
      { skill: "TypeScript", evidence: "3 years professional use" },
    ]);
  });

  it("defaults version to 1 when omitted", () => {
    const parsed = fitAnalysisSchema.parse(validFit());
    expect(parsed.version).toBe(1);
  });

  it("accepts an explicit version", () => {
    const parsed = fitAnalysisSchema.parse({ ...validFit(), version: 2 });
    expect(parsed.version).toBe(2);
  });

  it("REJECTS when overall is missing", () => {
    const { overall: _overall, ...rest } = validFit();
    const result = fitAnalysisSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("REJECTS when overall is out of range", () => {
    const tooHigh = fitAnalysisSchema.safeParse({ ...validFit(), overall: 150 });
    expect(tooHigh.success).toBe(false);

    const negative = fitAnalysisSchema.safeParse({ ...validFit(), overall: -5 });
    expect(negative.success).toBe(false);
  });

  it("REJECTS when overall is not a number", () => {
    const result = fitAnalysisSchema.safeParse({ ...validFit(), overall: "seventy" });
    expect(result.success).toBe(false);
  });

  it("degrades gracefully: garbage narrative fields fall back, record still parses", () => {
    const garbage = {
      id: "fit-1",
      applicationId: "app-1",
      overall: 55,
      label: 12345, // wrong type
      subScores: "not an object", // wrong type entirely
      whyMatch: { nested: "object" }, // wrong type
      alignedSkills: "not an array", // wrong type
      notAlignedSkills: [{ skill: "Go", advice: 999 }], // advice wrong type inside valid array shape
      createdAt: 1,
    };

    const parsed = fitAnalysisSchema.parse(garbage);
    expect(parsed.overall).toBe(55);
    expect(parsed.label).toBe("");
    expect(parsed.subScores).toEqual({ experience: 0, skills: 0, education: 0 });
    expect(parsed.whyMatch).toBe("");
    expect(parsed.alignedSkills).toEqual([]);
    expect(parsed.notAlignedSkills).toEqual([{ skill: "Go", advice: "" }]);
  });

  it("degrades only the bad key when a subScore field has its own .catch (per-field recovery)", () => {
    const parsed = fitAnalysisSchema.parse({
      ...validFit(),
      subScores: { experience: 80, skills: "not a number", education: 60 },
    });
    // each subScore field carries its own .catch(0), so a bad `skills` value
    // degrades only that key — the sibling fields survive.
    expect(parsed.subScores).toEqual({ experience: 80, skills: 0, education: 60 });
  });

  it("swallows the whole subScores object when it isn't an object at all (no per-field catch applies)", () => {
    const parsed = fitAnalysisSchema.parse({
      ...validFit(),
      subScores: "not an object",
    });
    expect(parsed.subScores).toEqual({ experience: 0, skills: 0, education: 0 });
  });

  it("swallows the whole alignedSkills array when an item field lacks its own catch (skill has none)", () => {
    const parsed = fitAnalysisSchema.parse({
      ...validFit(),
      alignedSkills: [{ skill: 12345, evidence: "x" }], // skill: z.string() has no .catch()
    });
    expect(parsed.alignedSkills).toEqual([]);
  });

  it("still requires id/applicationId/createdAt", () => {
    const { id: _id, ...rest } = validFit();
    expect(fitAnalysisSchema.safeParse(rest).success).toBe(false);

    const { applicationId: _applicationId, ...rest2 } = validFit();
    expect(fitAnalysisSchema.safeParse(rest2).success).toBe(false);

    const { createdAt: _createdAt, ...rest3 } = validFit();
    expect(fitAnalysisSchema.safeParse(rest3).success).toBe(false);
  });
});
