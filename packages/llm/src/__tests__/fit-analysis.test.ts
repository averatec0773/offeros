import { describe, it, expect } from "vitest";
import { fitAnalysisTask } from "../tasks/fit-analysis.task";
import { getTask } from "../registry";
import { runTask, type RunTaskDeps } from "../run-task";
import { makeFakeProvider } from "../fake-provider";
import { LlmError } from "../errors";

function deps(over: Partial<RunTaskDeps> = {}): RunTaskDeps {
  return {
    getTask,
    getOverride: async () => null,
    getModelOverride: async () => null,
    getProvider: async () => "anthropic",
    getKey: async () => "test-key",
    getModel: async () => "claude-sonnet-5",
    callProvider: makeFakeProvider(() => "{}"),
    ...over,
  };
}

const validRaw = JSON.stringify({
  overall: 72,
  label: "Strong match",
  subScores: { experience: 80, skills: 70, education: 60 },
  whyMatch: "Solid overlap with the required skills.",
  alignedSkills: [{ skill: "TypeScript", evidence: "3 years professional use" }],
  notAlignedSkills: [{ skill: "Go", advice: "Consider a small side project." }],
});

describe("fitAnalysisTask registration", () => {
  it("is registered under the id fit-analysis", () => {
    expect(getTask("fit-analysis")).toBe(fitAnalysisTask);
  });
});

describe("fitAnalysisTask", () => {
  it("buildUserPrompt embeds the profile, resume, JD, and skill overlap", () => {
    const prompt = fitAnalysisTask.buildUserPrompt({
      profileSummary: "5 years of TypeScript.",
      resumeText: "Built the widget pipeline.",
      jdText: "Need a TypeScript engineer who knows Go.",
      skillOverlap: { matched: ["TypeScript"], missing: ["Go"] },
    });
    expect(prompt).toContain("5 years of TypeScript.");
    expect(prompt).toContain("Built the widget pipeline.");
    expect(prompt).toContain("Need a TypeScript engineer who knows Go.");
    expect(prompt).toContain("TypeScript");
    expect(prompt).toContain("Go");
  });

  it("defaultSystemPrompt speaks in an evaluator voice and scores honestly", () => {
    expect(fitAnalysisTask.defaultSystemPrompt).toMatch(/evaluat/i);
    expect(fitAnalysisTask.defaultSystemPrompt.toLowerCase()).toContain("honest");
  });

  it("defaultSystemPrompt requires evidence for aligned skills and advice for gaps", () => {
    expect(fitAnalysisTask.defaultSystemPrompt.toLowerCase()).toContain("evidence");
    expect(fitAnalysisTask.defaultSystemPrompt.toLowerCase()).toMatch(/advice|suggestion/);
  });

  it("defaultSystemPrompt instructs consistency with the provided skillOverlap", () => {
    expect(fitAnalysisTask.defaultSystemPrompt.toLowerCase()).toContain("missing");
    expect(fitAnalysisTask.defaultSystemPrompt).toMatch(/never claim/i);
  });

  it("defaultSystemPrompt demands JSON-only output", () => {
    expect(fitAnalysisTask.defaultSystemPrompt.toLowerCase()).toContain("json");
  });

  it("schema is strict: additionalProperties false on the root", () => {
    expect((fitAnalysisTask.schema as { additionalProperties: boolean }).additionalProperties).toBe(
      false,
    );
  });

  it("parses valid structured output", () => {
    const out = fitAnalysisTask.parse(validRaw);
    expect(out.overall).toBe(72);
    expect(out.label).toBe("Strong match");
    expect(out.subScores).toEqual({ experience: 80, skills: 70, education: 60 });
    expect(out.alignedSkills).toEqual([
      { skill: "TypeScript", evidence: "3 years professional use" },
    ]);
    expect(out.notAlignedSkills).toEqual([
      { skill: "Go", advice: "Consider a small side project." },
    ]);
  });

  it("parses fenced JSON output", () => {
    const fenced = "```json\n" + validRaw + "\n```";
    const out = fitAnalysisTask.parse(fenced);
    expect(out.overall).toBe(72);
  });

  it("tolerates a partial object, filling defaults for missing fields", () => {
    const out = fitAnalysisTask.parse(JSON.stringify({ overall: 55 }));
    expect(out.overall).toBe(55);
    expect(out.label).toBe("");
    expect(out.subScores).toEqual({ experience: 0, skills: 0, education: 0 });
    expect(out.whyMatch).toBe("");
    expect(out.alignedSkills).toEqual([]);
    expect(out.notAlignedSkills).toEqual([]);
  });

  it("clamps a sub-score outside 0..100 instead of rejecting the whole record", () => {
    const sample = JSON.parse(validRaw);
    sample.subScores.skills = 140;
    const out = fitAnalysisTask.parse(JSON.stringify(sample));
    expect(out.subScores.skills).toBe(0);
    expect(out.subScores.experience).toBe(80);
  });

  it("throws LlmError(bad_output) on invalid JSON", () => {
    expect(() => fitAnalysisTask.parse("not json")).toThrow(LlmError);
    let kind = "";
    try {
      fitAnalysisTask.parse("not json");
    } catch (e) {
      if (e instanceof LlmError) kind = e.kind;
    }
    expect(kind).toBe("bad_output");
  });

  it("throws LlmError(bad_output) when overall is missing (required, no default)", () => {
    expect(() => fitAnalysisTask.parse(JSON.stringify({ label: "x" }))).toThrow(LlmError);
  });

  it("throws LlmError(bad_output) when overall is out of range", () => {
    expect(() =>
      fitAnalysisTask.parse(JSON.stringify({ ...JSON.parse(validRaw), overall: 150 })),
    ).toThrow(LlmError);
  });

  it("throws LlmError(bad_output) on non-object JSON output", () => {
    expect(() => fitAnalysisTask.parse('"just a string"')).toThrow(LlmError);
  });
});

describe("runTask prompt resolution for fit-analysis", () => {
  it("uses the per-task system-prompt override when present", async () => {
    const seen: string[] = [];
    const d = deps({
      getOverride: async () => "MY CUSTOM FIT ANALYSIS PROMPT",
      callProvider: makeFakeProvider((a) => {
        seen.push(a.system);
        return validRaw;
      }),
    });
    await runTask(
      "fit-analysis",
      {
        profileSummary: "p",
        resumeText: "r",
        jdText: "j",
        skillOverlap: { matched: [], missing: [] },
      },
      d,
    );
    expect(seen[0]).toBe("MY CUSTOM FIT ANALYSIS PROMPT");
  });

  it("falls back to the task default prompt when no override", async () => {
    const seen: string[] = [];
    const d = deps({
      callProvider: makeFakeProvider((a) => {
        seen.push(a.system);
        return validRaw;
      }),
    });
    await runTask(
      "fit-analysis",
      {
        profileSummary: "p",
        resumeText: "r",
        jdText: "j",
        skillOverlap: { matched: [], missing: [] },
      },
      d,
    );
    expect(seen[0]).toMatch(/evaluat/i);
  });

  it("returns the parsed structured shape via runTask", async () => {
    const d = deps({ callProvider: makeFakeProvider(() => validRaw) });
    const result = await runTask(
      "fit-analysis",
      {
        profileSummary: "p",
        resumeText: "r",
        jdText: "j",
        skillOverlap: { matched: ["TypeScript"], missing: ["Go"] },
      },
      d,
    );
    expect(result).toMatchObject({ overall: 72 });
  });
});
