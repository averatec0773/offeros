import { describe, it, expect } from "vitest";
import { resumeParseTask } from "../tasks/resume-parse.task";
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
  personal: {
    name: "Y",
    email: "",
    phone: "",
    address: "",
    linkedin: "",
    github: "",
    portfolio: "",
  },
  education: [],
  experience: [],
  skills: [],
  confidence: { personal: 0.9, education: 0.5, experience: 0.5, skills: 0.5 },
});

describe("resumeParseTask registration", () => {
  it("is registered under the id resume-parse", () => {
    expect(getTask("resume-parse")).toBe(resumeParseTask);
  });
});

describe("resumeParseTask", () => {
  it("buildUserPrompt embeds the resume text", () => {
    expect(resumeParseTask.buildUserPrompt({ resumeText: "MY RESUME BODY" })).toContain(
      "MY RESUME BODY",
    );
  });

  it("defaultSystemPrompt states the extraction rules", () => {
    expect(resumeParseTask.defaultSystemPrompt.toLowerCase()).toContain("empty string");
    expect(resumeParseTask.defaultSystemPrompt).toMatch(/never invent/i);
  });

  it("schema is strict: additionalProperties false on the root", () => {
    expect((resumeParseTask.schema as { additionalProperties: boolean }).additionalProperties).toBe(
      false,
    );
  });

  it("parses valid structured output into a ParsedResume", () => {
    const out = resumeParseTask.parse(validRaw);
    expect(out.personal.name).toBe("Y");
  });

  it("parses fenced JSON output", () => {
    const fenced = "```json\n" + validRaw + "\n```";
    const out = resumeParseTask.parse(fenced);
    expect(out.personal.name).toBe("Y");
  });

  it("tolerates a partial object, filling defaults for missing fields", () => {
    const out = resumeParseTask.parse('{"personal":{"name":"Y"}}');
    expect(out.personal.name).toBe("Y");
    expect(out.personal.email).toBe("");
    expect(out.education).toEqual([]);
    expect(out.skills).toEqual([]);
    expect(out.confidence.personal).toBe(0.5);
  });

  it("clamps confidence outside 0..1 instead of rejecting", () => {
    const sample = JSON.parse(validRaw);
    sample.confidence.personal = 1.4;
    const out = resumeParseTask.parse(JSON.stringify(sample));
    expect(out.confidence.personal).toBe(1);
  });

  it("coerces null fields to empty strings", () => {
    const sample = JSON.parse(validRaw);
    sample.personal.phone = null;
    sample.personal.github = null;
    const out = resumeParseTask.parse(JSON.stringify(sample));
    expect(out.personal.phone).toBe("");
    expect(out.personal.github).toBe("");
  });

  it("throws LlmError(bad_output) on invalid JSON", () => {
    expect(() => resumeParseTask.parse("not json")).toThrow(LlmError);
    let kind = "";
    try {
      resumeParseTask.parse("not json");
    } catch (e) {
      if (e instanceof LlmError) kind = e.kind;
    }
    expect(kind).toBe("bad_output");
  });

  it("throws LlmError(bad_output) on non-object JSON output", () => {
    expect(() => resumeParseTask.parse('"just a string"')).toThrow(LlmError);
  });
});

describe("runTask prompt resolution for resume-parse", () => {
  it("uses the per-task system-prompt override when present", async () => {
    const seen: string[] = [];
    const d = deps({
      getOverride: async () => "MY CUSTOM RESUME PARSE PROMPT",
      callProvider: makeFakeProvider((a) => {
        seen.push(a.system);
        return validRaw;
      }),
    });
    await runTask("resume-parse", { resumeText: "resume body" }, d);
    expect(seen[0]).toBe("MY CUSTOM RESUME PARSE PROMPT");
  });

  it("falls back to the task default prompt when no override", async () => {
    const seen: string[] = [];
    const d = deps({
      callProvider: makeFakeProvider((a) => {
        seen.push(a.system);
        return validRaw;
      }),
    });
    await runTask("resume-parse", { resumeText: "resume body" }, d);
    expect(seen[0]).toMatch(/never invent/i);
  });

  it("returns the parsed structured shape via runTask", async () => {
    const d = deps({ callProvider: makeFakeProvider(() => validRaw) });
    const result = await runTask("resume-parse", { resumeText: "resume body" }, d);
    expect(result).toMatchObject({ personal: { name: "Y" } });
  });
});
