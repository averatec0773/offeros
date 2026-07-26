import { describe, it, expect } from "vitest";
import { questionAnswerTask } from "../tasks/question-answer.task";
import { getTask } from "../registry";
import { runTask, type RunTaskDeps } from "../run-task";
import { makeFakeProvider } from "../fake-provider";

function deps(over: Partial<RunTaskDeps> = {}): RunTaskDeps {
  return {
    getTask,
    getOverride: async () => null,
    getModelOverride: async () => null,
    getProvider: async () => "anthropic",
    getKey: async () => "test-key",
    getModel: async () => "claude-sonnet-5",
    callProvider: makeFakeProvider(() => "OK"),
    ...over,
  };
}

const baseInput = {
  question: "Why do you want to work here?",
  label: "Why this company?",
  profileSummary: "5 years of TypeScript experience.",
  jdText: "We need a GenAI engineer at Evolver.",
  resumeText: "Built the widget pipeline.",
};

describe("questionAnswerTask registration", () => {
  it("is registered under the id question-answer", () => {
    expect(getTask("question-answer")).toBe(questionAnswerTask);
  });
});

describe("questionAnswerTask", () => {
  it("defaultSystemPrompt encodes grounding + first-person + no-invention constraints", () => {
    expect(questionAnswerTask.defaultSystemPrompt).toMatch(/first person/i);
    expect(questionAnswerTask.defaultSystemPrompt).toMatch(/120 words/);
    expect(questionAnswerTask.defaultSystemPrompt).toMatch(/never invent/i);
  });

  it("buildUserPrompt includes the question, label, profile, JD, and resume", () => {
    const prompt = questionAnswerTask.buildUserPrompt(baseInput);
    expect(prompt).toContain("Why do you want to work here?");
    expect(prompt).toContain("Why this company?");
    expect(prompt).toContain("5 years of TypeScript experience.");
    expect(prompt).toContain("We need a GenAI engineer at Evolver.");
    expect(prompt).toContain("Built the widget pipeline.");
  });

  it("buildUserPrompt includes context and existingAnswer when present", () => {
    const prompt = questionAnswerTask.buildUserPrompt({
      ...baseInput,
      context: "Multiple choice, but also accepts free text.",
      existingAnswer: "I like the mission.",
    });
    expect(prompt).toContain("Multiple choice, but also accepts free text.");
    expect(prompt).toContain("I like the mission.");
  });

  it("parse trims provider output and wraps it as { answer }", () => {
    expect(
      questionAnswerTask.parse("  I'm excited to build GenAI pipelines at Evolver.  \n"),
    ).toEqual({
      answer: "I'm excited to build GenAI pipelines at Evolver.",
    });
  });

  it("parse returns plain text as-is (no JSON/markdown scaffold expected)", () => {
    expect(questionAnswerTask.parse("Plain answer text.")).toEqual({
      answer: "Plain answer text.",
    });
  });
});

describe("runTask prompt resolution for question-answer", () => {
  it("uses the per-task system-prompt override when present", async () => {
    const seen: string[] = [];
    const d = deps({
      getOverride: async () => "MY CUSTOM QA PROMPT",
      callProvider: makeFakeProvider((a) => {
        seen.push(a.system);
        return "answer";
      }),
    });
    await runTask("question-answer", baseInput, d);
    expect(seen[0]).toBe("MY CUSTOM QA PROMPT");
  });

  it("falls back to the task default prompt when no override", async () => {
    const seen: string[] = [];
    const d = deps({
      callProvider: makeFakeProvider((a) => {
        seen.push(a.system);
        return "answer";
      }),
    });
    await runTask("question-answer", baseInput, d);
    expect(seen[0]).toMatch(/never invent/i);
  });

  it("surfaces provider text as { answer } trimmed via runTask", async () => {
    const d = deps({
      callProvider: makeFakeProvider(() => "  Grounded answer.  "),
    });
    const result = await runTask("question-answer", baseInput, d);
    expect(result).toEqual({ answer: "Grounded answer." });
  });
});
