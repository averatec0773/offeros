import { describe, it, expect } from "vitest";
import type { JobInfo } from "@offeros/core";
import { extractJson } from "../parse-json";
import { jdAnalysisTask } from "../tasks/jd-analysis.task";
import { coverLetterTask } from "../tasks/cover-letter.task";

const jobInfo: JobInfo = { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver" };

describe("extractJson", () => {
  it("parses plain JSON", () => {
    const obj = { key: "value", num: 42 };
    const raw = JSON.stringify(obj);
    expect(extractJson(raw)).toEqual(obj);
  });

  it("parses JSON wrapped in ```json ... ``` fence", () => {
    const obj = { key: "value", num: 42 };
    const fenced = `\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;
    expect(extractJson(fenced)).toEqual(obj);
  });

  it("parses JSON wrapped in ``` ... ``` fence", () => {
    const obj = { key: "value", num: 42 };
    const fenced = `\`\`\`\n${JSON.stringify(obj)}\n\`\`\``;
    expect(extractJson(fenced)).toEqual(obj);
  });

  it("throws LlmError on invalid JSON", () => {
    expect(() => extractJson("{ invalid }")).toThrow();
  });
});

describe("jdAnalysisTask", () => {
  it("buildUserPrompt includes the JD text, profile summary, title, and company", () => {
    const prompt = jdAnalysisTask.buildUserPrompt({
      jdText: "Must know TypeScript.",
      jobInfo,
      profileSummary: "5 years of TypeScript experience.",
    });
    expect(prompt).toContain("Must know TypeScript.");
    expect(prompt).toContain("5 years of TypeScript experience.");
    expect(prompt).toContain("GenAI Engineer");
    expect(prompt).toContain("Evolver");
  });

  it("parse handles a representative fake response", () => {
    const raw = JSON.stringify({
      summary: "A GenAI engineering role.",
      responsibilities: ["Build LLM pipelines"],
      requiredSkills: ["TypeScript"],
      preferredSkills: ["Python"],
      matchNotes: ["5 years of TypeScript experience"],
      gaps: ["No Python experience listed"],
      coverLetterRequirement: "optional",
    });
    expect(jdAnalysisTask.parse(raw)).toMatchObject({
      summary: "A GenAI engineering role.",
      coverLetterRequirement: "optional",
    });
  });

  it("parse throws LlmError on malformed output", () => {
    expect(() => jdAnalysisTask.parse("not json")).toThrow();
    expect(() => jdAnalysisTask.parse(JSON.stringify({ summary: "x" }))).toThrow();
  });

  it("parse accepts a fenced JSON response", () => {
    const obj = {
      summary: "A GenAI engineering role.",
      responsibilities: ["Build LLM pipelines"],
      requiredSkills: ["TypeScript"],
      preferredSkills: ["Python"],
      matchNotes: ["5 years of TypeScript experience"],
      gaps: ["No Python experience listed"],
      coverLetterRequirement: "optional",
    };
    const fenced = `\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;
    expect(jdAnalysisTask.parse(fenced)).toMatchObject({ summary: "A GenAI engineering role." });
  });
});

describe("coverLetterTask", () => {
  it("defaultSystemPrompt encodes the fixed letter anatomy", () => {
    expect(coverLetterTask.defaultSystemPrompt).toContain("Dear Hiring Team,");
    expect(coverLetterTask.defaultSystemPrompt).toContain("EXACTLY three body paragraphs");
    expect(coverLetterTask.defaultSystemPrompt).toContain("Never invent");
  });

  it("buildUserPrompt includes grounding facts, JD summary, and title/company", () => {
    const prompt = coverLetterTask.buildUserPrompt({
      jobInfo,
      groundingFacts: "Name: Jordan Rivera. Led the widget pipeline rollout.",
      jdSummary: "Looking for a GenAI engineer to own LLM pipelines.",
    });
    expect(prompt).toContain("Jordan Rivera");
    expect(prompt).toContain("Looking for a GenAI engineer to own LLM pipelines.");
    expect(prompt).toContain("GenAI Engineer");
    expect(prompt).toContain("Evolver");
  });

  it("buildUserPrompt includes instruction and previousContent when revising", () => {
    const prompt = coverLetterTask.buildUserPrompt({
      jobInfo,
      groundingFacts: "Name: Jordan Rivera.",
      previousContent: "Dear Hiring Team,\n\nFirst draft body.",
      instruction: "Make the second paragraph more technical.",
    });
    expect(prompt).toContain("First draft body.");
    expect(prompt).toContain("Make the second paragraph more technical.");
  });

  it("buildUserPrompt is byte-identical whether or not templateHints is omitted vs undefined", () => {
    const input = {
      jobInfo,
      groundingFacts: "Name: Jordan Rivera.",
      jdSummary: "Looking for a GenAI engineer.",
    };
    const withoutField = coverLetterTask.buildUserPrompt(input);
    const withUndefined = coverLetterTask.buildUserPrompt({ ...input, templateHints: undefined });
    expect(withUndefined).toBe(withoutField);
  });

  it("buildUserPrompt prepends a labeled 'User template constraints' block when templateHints is set", () => {
    const withoutHints = coverLetterTask.buildUserPrompt({
      jobInfo,
      groundingFacts: "Name: Jordan Rivera.",
      jdSummary: "Looking for a GenAI engineer.",
    });
    const withHints = coverLetterTask.buildUserPrompt({
      jobInfo,
      groundingFacts: "Name: Jordan Rivera.",
      jdSummary: "Looking for a GenAI engineer.",
      templateHints: 'Salutation: "Dear Hiring Team,". Closing: "Sincerely,". Body: 4 paragraphs.',
    });
    expect(withHints).not.toBe(withoutHints);
    expect(withHints).toContain(
      'User template constraints:\nSalutation: "Dear Hiring Team,". Closing: "Sincerely,". Body: 4 paragraphs.',
    );
    // Prepended: appears right after the Role line, before the grounding facts section.
    expect(withHints.indexOf("User template constraints:")).toBeLessThan(
      withHints.indexOf("Grounding facts"),
    );
  });

  it("parse handles a representative fake response", () => {
    const raw = JSON.stringify({
      content: "Dear Hiring Team,\n\n...\n\nSincerely, Jordan Rivera",
      rationale: "Emphasizes the widget pipeline rollout.",
    });
    expect(coverLetterTask.parse(raw)).toEqual({
      content: "Dear Hiring Team,\n\n...\n\nSincerely, Jordan Rivera",
      rationale: "Emphasizes the widget pipeline rollout.",
    });
  });

  it("parse throws LlmError on malformed output", () => {
    expect(() => coverLetterTask.parse("not json")).toThrow();
    expect(() => coverLetterTask.parse(JSON.stringify({ content: "x" }))).toThrow();
  });

  it("parse accepts a fenced JSON response", () => {
    const obj = {
      content: "Dear Hiring Team,\n\n...\n\nSincerely, Jordan Rivera",
      rationale: "Emphasizes the widget pipeline rollout.",
    };
    const fenced = `\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;
    expect(coverLetterTask.parse(fenced)).toEqual(obj);
  });

  it("parse rejects missing rationale field", () => {
    const malformed = JSON.stringify({
      content: "Dear Hiring Team,\n\nSincerely, Jordan",
    });
    expect(() => coverLetterTask.parse(malformed)).toThrow();
  });
});
