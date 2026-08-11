import { describe, it, expect } from "vitest";
import { jdAnalysisSchema, artifactSchema, pipelineTaskSchema } from "../index";

describe("jdAnalysisSchema", () => {
  it("parses an analysis with gaps and a requirement", () => {
    const a = jdAnalysisSchema.parse({
      id: "jd1",
      applicationId: "app1",
      summary: "ML role",
      responsibilities: ["build models"],
      requiredSkills: ["Python"],
      preferredSkills: ["AWS"],
      matchNotes: ["strong ML"],
      gaps: ["no explicit AWS"],
      coverLetterRequirement: "optional",
      createdAt: 1,
    });
    expect(a.gaps).toEqual(["no explicit AWS"]);
    expect(a.coverLetterRequirement).toBe("optional");
  });
  it("defaults arrays and rejects a bad requirement", () => {
    const a = jdAnalysisSchema.parse({
      id: "j",
      applicationId: "a",
      summary: "s",
      coverLetterRequirement: "none",
      createdAt: 1,
    });
    expect(a.responsibilities).toEqual([]);
    expect(
      jdAnalysisSchema.safeParse({
        id: "j",
        applicationId: "a",
        summary: "s",
        coverLetterRequirement: "bogus",
        createdAt: 1,
      }).success,
    ).toBe(false);
  });
});

describe("artifactSchema", () => {
  it("holds versioned content", () => {
    const art = artifactSchema.parse({
      id: "art1",
      taskId: "t1",
      kind: "cover-letter",
      versions: [{ id: "v1", content: "Dear Hiring Team,", rationale: "initial", createdAt: 1 }],
      currentVersionId: "v1",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(art.versions).toHaveLength(1);
    expect(art.kind).toBe("cover-letter");
  });
});

describe("pipelineTaskSchema additions", () => {
  it("defaults coverLetterRequirement and skippedCoverLetter", () => {
    const t = pipelineTaskSchema.parse({
      id: "t",
      applicationId: "a",
      status: "queued",
      step: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(t.coverLetterRequirement).toBe("unknown");
    expect(t.skippedCoverLetter).toBe(false);
  });

  it("parses without failureReason (backward compat) and round-trips it when present", () => {
    const noReason = pipelineTaskSchema.parse({
      id: "t",
      applicationId: "a",
      status: "failed",
      step: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(noReason.failureReason).toBeUndefined();

    const withReason = pipelineTaskSchema.parse({
      id: "t",
      applicationId: "a",
      status: "failed",
      step: 0,
      failureReason: "The AI response couldn't be parsed — try again or switch models.",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(withReason.failureReason).toBe(
      "The AI response couldn't be parsed — try again or switch models.",
    );
  });
});
