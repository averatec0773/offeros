import { describe, it, expect } from "vitest";
import {
  profileSchema,
  applicationSchema,
  resumeSchema,
  agentTaskSchema,
  applicationInfoSchema,
  settingsSchema,
  PIPELINE_STEPS,
} from "../index";

describe("profileSchema", () => {
  it("accepts a minimal profile and defaults collections", () => {
    const parsed = profileSchema.parse({
      personal: { name: "Jordan Rivera", email: "j@example.com", phone: "555", links: {} },
    });
    expect(parsed.skills).toEqual([]);
    expect(parsed.education).toEqual([]);
    expect(parsed.experience).toEqual([]);
  });

  it("rejects a profile with no personal block", () => {
    expect(profileSchema.safeParse({}).success).toBe(false);
  });
});

describe("applicationSchema", () => {
  it("accepts a saved application", () => {
    const app = applicationSchema.parse({
      id: "app-1",
      jobInfo: { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver" },
      status: "saved",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(app.status).toBe("saved");
  });

  it("rejects an unknown status", () => {
    const bad = applicationSchema.safeParse({
      id: "a",
      jobInfo: { jobId: "j", jobTitle: "t", companyName: "c" },
      status: "nonsense",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(bad.success).toBe(false);
  });

  it("round-trips an optional resumeId and parses an old-shaped application without one", () => {
    const withResume = applicationSchema.parse({
      id: "app-2",
      jobInfo: { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver" },
      status: "saved",
      resumeId: "resume-7",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(withResume.resumeId).toBe("resume-7");

    // An application persisted before Task 3 has no resumeId — still valid.
    const old = applicationSchema.parse({
      id: "app-3",
      jobInfo: { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver" },
      status: "saved",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(old.resumeId).toBeUndefined();
  });
});

describe("resumeSchema", () => {
  it("round-trips an optional note and parses an old-shaped resume without one", () => {
    const withNote = resumeSchema.parse({
      id: "r1",
      name: "Backend.pdf",
      mimeType: "application/pdf",
      note: "For backend / platform roles",
      createdAt: 1,
    });
    expect(withNote.note).toBe("For backend / platform roles");
    expect(withNote.isPrimary).toBe(false);

    // A resume row persisted before Task 3 has no note — still valid.
    const old = resumeSchema.parse({
      id: "r2",
      name: "Old.pdf",
      mimeType: "application/pdf",
      createdAt: 1,
    });
    expect(old.note).toBeUndefined();
  });

  it("round-trips an optional text and parses an old-shaped resume without one", () => {
    const withText = resumeSchema.parse({
      id: "r1",
      name: "Backend.pdf",
      mimeType: "application/pdf",
      text: "Jordan Rivera\nBackend engineer...",
      createdAt: 1,
    });
    expect(withText.text).toBe("Jordan Rivera\nBackend engineer...");

    // A resume row persisted before Task 2 has no text — still valid.
    const old = resumeSchema.parse({
      id: "r2",
      name: "Old.pdf",
      mimeType: "application/pdf",
      createdAt: 1,
    });
    expect(old.text).toBeUndefined();
  });
});

describe("agentTaskSchema + applicationInfo gate", () => {
  it("models the action-required gate", () => {
    const info = applicationInfoSchema.parse({
      status: 2,
      filledFields: ["First Name"],
      missingFields: ["LinkedIn Profile"],
    });
    expect(info.missingFields).toEqual(["LinkedIn Profile"]);

    const task = agentTaskSchema.parse({
      id: "t1",
      applicationId: "app-1",
      status: "awaiting_user",
      step: 6,
      applicationInfo: info,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(task.status).toBe("awaiting_user");
  });
});

describe("settingsSchema", () => {
  it("defaults llm override maps to empty objects", () => {
    const parsed = settingsSchema.parse({});
    expect(parsed.llm.promptOverrides).toEqual({});
    expect(parsed.llm.modelOverrides).toEqual({});
    expect(parsed.llm.apiKeys).toEqual({});
  });

  it("round-trips saved api keys keyed by provider", () => {
    const parsed = settingsSchema.parse({
      llm: { apiKeys: { openai: "sk-x" } },
    });
    expect(parsed.llm.apiKeys).toEqual({ openai: "sk-x" });
  });

  it("accepts per-task prompt and model overrides", () => {
    const parsed = settingsSchema.parse({
      llm: {
        promptOverrides: { "cover-letter": "MY CUSTOM PROMPT" },
        modelOverrides: { "cover-letter": "gpt-4o" },
      },
    });
    expect(parsed.llm.promptOverrides["cover-letter"]).toBe("MY CUSTOM PROMPT");
    expect(parsed.llm.modelOverrides["cover-letter"]).toBe("gpt-4o");
  });
});

describe("PIPELINE_STEPS", () => {
  it("has the 7 observed milestones in order", () => {
    expect(PIPELINE_STEPS.map((s) => s.key)).toEqual([
      "tailor-resume",
      "confirm-resume",
      "analyze-site",
      "generate-cover-letter",
      "confirm-cover-letter",
      "fill-form",
      "submit",
    ]);
  });
});
