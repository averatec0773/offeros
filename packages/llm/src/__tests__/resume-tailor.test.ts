import { describe, it, expect } from "vitest";
import type { JobInfo } from "@offeros/core";
import { resumeTailorTask } from "../tasks/resume-tailor.task";
import { getTask } from "../registry";
import { runTask, type RunTaskDeps } from "../run-task";
import { makeFakeProvider } from "../fake-provider";
import { LlmError } from "../errors";

const jobInfo: JobInfo = { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver" };

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

const validStructured = {
  summary: "GenAI engineer with a track record shipping LLM pipelines.",
  experience: [
    {
      company: "Evolver",
      title: "GenAI Engineer",
      dates: "2021 – Present",
      bullets: ["Built the widget pipeline for a GenAI product."],
    },
  ],
  education: [
    {
      school: "State University",
      degree: "B.S.",
      field: "Computer Science",
      dates: "2017 – 2021",
      details: "",
    },
  ],
  skills: ["TypeScript", "LLMs"],
};

const validRaw = JSON.stringify({
  structured: validStructured,
  rationale: "Emphasized GenAI pipeline work to match the job description.",
  changedLines: ["Built the widget pipeline for a GenAI product."],
});

describe("resumeTailorTask registration", () => {
  it("is registered under the id resume-tailor", () => {
    expect(getTask("resume-tailor")).toBe(resumeTailorTask);
  });
});

describe("resumeTailorTask", () => {
  it("buildUserPrompt includes the resume text, JD text, title, and company", () => {
    const prompt = resumeTailorTask.buildUserPrompt({
      resumeText: "Built the widget pipeline.",
      jobInfo,
      jdText: "We need a GenAI engineer at Evolver.",
    });
    expect(prompt).toContain("Built the widget pipeline.");
    expect(prompt).toContain("We need a GenAI engineer at Evolver.");
    expect(prompt).toContain("GenAI Engineer");
    expect(prompt).toContain("Evolver");
  });

  it("buildUserPrompt includes previousContent and instruction on a tweak re-run", () => {
    const prompt = resumeTailorTask.buildUserPrompt({
      resumeText: "Built the widget pipeline.",
      jobInfo,
      jdText: "We need a GenAI engineer at Evolver.",
      previousContent: "Previous tailored draft text.",
      instruction: "Emphasize leadership.",
    });
    expect(prompt).toContain("Previous tailored draft text.");
    expect(prompt).toContain("Emphasize leadership.");
  });

  it("defaultSystemPrompt keeps the strict never-invent grounding wording", () => {
    const p = resumeTailorTask.defaultSystemPrompt.toLowerCase();
    expect(p).toContain("never invent");
    expect(p).toContain("employers");
    expect(p).toContain("titles");
    expect(p).toContain("dates");
    expect(p).toContain("metrics");
    expect(p).toContain("skills");
  });

  it("defaultSystemPrompt instructs single-line field text (no embedded newlines)", () => {
    expect(resumeTailorTask.defaultSystemPrompt.toLowerCase()).toContain("single line");
    expect(resumeTailorTask.defaultSystemPrompt.toLowerCase()).toContain("newline");
  });

  it("defaultSystemPrompt demands structured JSON output", () => {
    expect(resumeTailorTask.defaultSystemPrompt.toLowerCase()).toContain("json");
    expect(resumeTailorTask.defaultSystemPrompt).toContain("structured");
  });

  it("schema is strict: additionalProperties false on the root", () => {
    expect(
      (resumeTailorTask.schema as { additionalProperties: boolean }).additionalProperties,
    ).toBe(false);
  });

  it("parses a valid structured response", () => {
    const out = resumeTailorTask.parse(validRaw);
    expect(out.structured).toEqual(validStructured);
    expect(out.rationale).toBe("Emphasized GenAI pipeline work to match the job description.");
    expect(out.changedLines).toEqual(["Built the widget pipeline for a GenAI product."]);
  });

  it("parses a fenced JSON response", () => {
    const fenced = "```json\n" + validRaw + "\n```";
    const out = resumeTailorTask.parse(fenced);
    expect(out.structured).toEqual(validStructured);
  });

  it("throws LlmError(bad_output) on non-JSON input", () => {
    expect(() => resumeTailorTask.parse("not json")).toThrow(LlmError);
    let kind = "";
    try {
      resumeTailorTask.parse("not json");
    } catch (e) {
      if (e instanceof LlmError) kind = e.kind;
    }
    expect(kind).toBe("bad_output");
  });

  it("throws LlmError(bad_output) on non-object JSON output", () => {
    expect(() => resumeTailorTask.parse('"just a string"')).toThrow(LlmError);
  });

  it("tolerates a partial object, filling defaults for missing fields (record survives)", () => {
    const out = resumeTailorTask.parse(JSON.stringify({ rationale: "Partial output." }));
    expect(out.rationale).toBe("Partial output.");
    expect(out.structured).toEqual({ summary: "", experience: [], education: [], skills: [] });
    expect(out.changedLines).toEqual([]);
  });

  it("tolerates a garbage `structured` value instead of rejecting the whole record", () => {
    const out = resumeTailorTask.parse(
      JSON.stringify({ structured: "not an object", rationale: "x", changedLines: [] }),
    );
    expect(out.structured).toEqual({ summary: "", experience: [], education: [], skills: [] });
    expect(out.rationale).toBe("x");
  });

  it("tolerates a malformed experience/education entry, defaulting just the missing fields", () => {
    const out = resumeTailorTask.parse(
      JSON.stringify({
        structured: { ...validStructured, experience: [{ company: "Evolver" }] },
        rationale: "x",
        changedLines: [],
      }),
    );
    expect(out.structured.experience).toEqual([
      { company: "Evolver", title: "", dates: "", bullets: [] },
    ]);
  });
});

describe("runTask prompt resolution for resume-tailor", () => {
  it("uses the per-task system-prompt override when present", async () => {
    const seen: string[] = [];
    const d = deps({
      getOverride: async () => "MY CUSTOM RESUME TAILOR PROMPT",
      callProvider: makeFakeProvider((a) => {
        seen.push(a.system);
        return validRaw;
      }),
    });
    await runTask("resume-tailor", { resumeText: "r", jobInfo, jdText: "j" }, d);
    expect(seen[0]).toBe("MY CUSTOM RESUME TAILOR PROMPT");
  });

  it("falls back to the task default prompt when no override", async () => {
    const seen: string[] = [];
    const d = deps({
      callProvider: makeFakeProvider((a) => {
        seen.push(a.system);
        return validRaw;
      }),
    });
    await runTask("resume-tailor", { resumeText: "r", jobInfo, jdText: "j" }, d);
    expect(seen[0]!.toLowerCase()).toContain("never invent");
  });

  it("returns the parsed structured shape via runTask", async () => {
    const d = deps({ callProvider: makeFakeProvider(() => validRaw) });
    const result = await runTask("resume-tailor", { resumeText: "r", jobInfo, jdText: "j" }, d);
    expect(result).toMatchObject({ structured: validStructured });
  });
});
