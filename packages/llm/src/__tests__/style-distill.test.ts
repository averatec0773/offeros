import { describe, it, expect } from "vitest";
import { styleDistillTask, type StyleDistillInput } from "../tasks/style-distill.task";
import { getTask } from "../registry";

const baseInput: StyleDistillInput = {
  existingNotes: "",
  instructions: ["Make it punchier.", "Cut the corporate jargon."],
  firstContent: "First AI draft text.",
  approvedContent: "Final approved draft text.",
  maxChars: 2000,
};

describe("styleDistillTask registration", () => {
  it("is registered under the id style-distill", () => {
    expect(getTask("style-distill")).toBe(styleDistillTask);
  });
});

describe("styleDistillTask hard rules", () => {
  it("defaultSystemPrompt restricts extraction to style/preference signals only", () => {
    const p = styleDistillTask.defaultSystemPrompt;
    expect(p).toContain("STYLE");
    expect(p).toContain("PREFERENCE");
    expect(p.toLowerCase()).toContain("tone");
    expect(p.toLowerCase()).toContain("structure");
    expect(p.toLowerCase()).toContain("emphasis");
    expect(p.toLowerCase()).toContain("wording");
    expect(p.toLowerCase()).toContain("formatting");
  });

  it("defaultSystemPrompt forbids recording content facts", () => {
    const p = styleDistillTask.defaultSystemPrompt;
    expect(p).toContain("NEVER record");
    expect(p).toContain("employers");
    expect(p).toContain("job titles");
    expect(p).toContain("company names");
    expect(p).toContain("dates");
    expect(p).toContain("metrics");
  });

  it("defaultSystemPrompt requires merging/deduping with existing notes and staying under the cap", () => {
    const p = styleDistillTask.defaultSystemPrompt.toLowerCase();
    expect(p).toContain("merge");
    expect(p).toContain("dedup");
    expect(p).toContain("character cap");
  });

  it("defaultSystemPrompt requires plain bullet lines", () => {
    expect(styleDistillTask.defaultSystemPrompt.toLowerCase()).toContain("bullet");
  });

  it("schema is strict: additionalProperties false on the root", () => {
    expect(
      (styleDistillTask.schema as { additionalProperties: boolean }).additionalProperties,
    ).toBe(false);
  });
});

describe("styleDistillTask buildUserPrompt", () => {
  it("includes existingNotes, instructions (in order), firstContent, and approvedContent", () => {
    const prompt = styleDistillTask.buildUserPrompt({
      ...baseInput,
      existingNotes: "- Prefers active voice.",
    });
    expect(prompt).toContain("- Prefers active voice.");
    expect(prompt.indexOf("1. Make it punchier.")).toBeGreaterThanOrEqual(0);
    expect(prompt.indexOf("2. Cut the corporate jargon.")).toBeGreaterThan(
      prompt.indexOf("1. Make it punchier."),
    );
    expect(prompt).toContain("First AI draft text.");
    expect(prompt).toContain("Final approved draft text.");
  });

  it("includes the numeric character cap so the model knows the limit", () => {
    const prompt = styleDistillTask.buildUserPrompt({ ...baseInput, maxChars: 2000 });
    expect(prompt).toContain("2000");
  });

  it("handles empty existingNotes and instructions gracefully", () => {
    const prompt = styleDistillTask.buildUserPrompt({
      ...baseInput,
      existingNotes: "",
      instructions: [],
    });
    expect(prompt).toContain("(none yet)");
    expect(prompt).toContain("(none)");
  });
});

describe("styleDistillTask.parse — tolerant", () => {
  it("parses a valid { notes } response", () => {
    expect(
      styleDistillTask.parse(JSON.stringify({ notes: "- Prefers punchier phrasing." })),
    ).toEqual({ notes: "- Prefers punchier phrasing." });
  });

  it("parses a fenced JSON response", () => {
    const fenced = '```json\n{"notes":"- Concise bullets."}\n```';
    expect(styleDistillTask.parse(fenced)).toEqual({ notes: "- Concise bullets." });
  });

  it("does not throw on non-JSON garbage — degrades to empty notes", () => {
    expect(() => styleDistillTask.parse("not json at all")).not.toThrow();
    expect(styleDistillTask.parse("not json at all")).toEqual({ notes: "" });
  });

  it("does not throw when notes is missing — degrades to empty notes", () => {
    expect(styleDistillTask.parse(JSON.stringify({}))).toEqual({ notes: "" });
  });

  it("does not throw when notes is the wrong type — degrades to empty notes", () => {
    expect(styleDistillTask.parse(JSON.stringify({ notes: 42 }))).toEqual({ notes: "" });
  });

  it("does not throw when the whole response is not an object", () => {
    expect(styleDistillTask.parse(JSON.stringify("just a string"))).toEqual({ notes: "" });
    expect(styleDistillTask.parse(JSON.stringify(null))).toEqual({ notes: "" });
  });
});
