import { describe, it, expect } from "vitest";
import { artifactVersionSchema } from "../artifact";

describe("artifactVersionSchema", () => {
  it("parses a version without resumeData (old-shape compat)", () => {
    const parsed = artifactVersionSchema.parse({
      id: "v1",
      content: "plain text resume",
      createdAt: 1,
    });
    expect(parsed.resumeData).toBeUndefined();
  });

  it("parses a version with resumeData", () => {
    const parsed = artifactVersionSchema.parse({
      id: "v2",
      content: "plain text resume",
      createdAt: 1,
      resumeData: {
        summary: "Backend engineer.",
        experience: [],
        education: [],
        skills: ["Go"],
      },
    });
    expect(parsed.resumeData).toEqual({
      summary: "Backend engineer.",
      experience: [],
      education: [],
      skills: ["Go"],
    });
  });

  it("degrades garbage resumeData to defaults rather than rejecting the version", () => {
    const parsed = artifactVersionSchema.parse({
      id: "v3",
      content: "plain text resume",
      createdAt: 1,
      resumeData: "not a resume object",
    });
    expect(parsed.resumeData).toEqual({
      summary: "",
      experience: [],
      education: [],
      skills: [],
    });
  });
});
