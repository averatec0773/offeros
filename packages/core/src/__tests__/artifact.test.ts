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

  it("parses a version with no instruction (old-shape compat)", () => {
    const parsed = artifactVersionSchema.parse({
      id: "v4",
      content: "plain text resume",
      createdAt: 1,
    });
    expect(parsed.instruction).toBeUndefined();
  });

  it("round-trips a persisted tweak instruction", () => {
    const parsed = artifactVersionSchema.parse({
      id: "v5",
      content: "revised resume",
      createdAt: 1,
      instruction: "Add a metrics line to the Acme bullet.",
    });
    expect(parsed.instruction).toBe("Add a metrics line to the Acme bullet.");
  });
});
