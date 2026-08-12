import { describe, it, expect } from "vitest";
import {
  artifactName,
  artifactSchema,
  artifactVersionSchema,
  defaultArtifactName,
  sanitizeNamePart,
} from "../artifact";

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

/** 2026-08-12T00:00:00Z, so the date in a name is fixed rather than "today". */
const AUG_12 = Date.UTC(2026, 7, 12, 6, 30);

describe("document names", () => {
  it("names a résumé and a letter after the company and the day", () => {
    expect(defaultArtifactName("resume", "Acme", AUG_12)).toBe("resume_Acme_2026-08-12");
    expect(defaultArtifactName("cover-letter", "Acme", AUG_12)).toBe("cover_Acme_2026-08-12");
  });

  it("strips what a filename cannot carry, and the spaces", () => {
    // Windows-reserved characters, both path separators, and quotes all go.
    expect(defaultArtifactName("resume", 'Acme / Beta: "Gamma" <Delta>?*|\\', AUG_12)).toBe(
      "resume_AcmeBetaGammaDelta_2026-08-12",
    );
    // A trailing dot goes too — Windows refuses a file name that ends in one.
    expect(defaultArtifactName("resume", "Evolver AI Inc.", AUG_12)).toBe(
      "resume_EvolverAIInc_2026-08-12",
    );
  });

  it("keeps letters that are not ASCII rather than naming the document after nothing", () => {
    // A company written in Chinese is a company. Stripping to ASCII produced
    // "resume__2026-08-12" for every one of them.
    expect(defaultArtifactName("resume", "字节跳动", AUG_12)).toBe("resume_字节跳动_2026-08-12");
    expect(defaultArtifactName("cover-letter", "Ström & Söhne", AUG_12)).toBe(
      "cover_Ström&Söhne_2026-08-12",
    );
  });

  it("falls back to a word rather than an empty gap when nothing survives", () => {
    expect(defaultArtifactName("resume", "  ///  ", AUG_12)).toBe("resume_job_2026-08-12");
    expect(defaultArtifactName("resume", "", AUG_12)).toBe("resume_job_2026-08-12");
  });

  it("bounds the company part, and never ends on a dot", () => {
    const long = "A".repeat(80);
    expect(sanitizeNamePart(long)).toHaveLength(40);
    expect(sanitizeNamePart("Acme...")).toBe("Acme");
  });

  it("derives the same name for an artifact stored before names existed", () => {
    // The lazy read: no migration, no write on a read path. The default comes
    // off the artifact's OWN createdAt, so it is identical on every read.
    const stored = artifactSchema.parse({
      id: "a1",
      taskId: "t1",
      kind: "resume",
      versions: [{ id: "v1", content: "x", createdAt: AUG_12 }],
      currentVersionId: "v1",
      createdAt: AUG_12,
      updatedAt: AUG_12 + 5_000,
    });
    expect(stored.name).toBeUndefined();
    expect(artifactName(stored, "Acme")).toBe("resume_Acme_2026-08-12");
    expect(artifactName(stored, "Acme")).toBe(artifactName(stored, "Acme"));
  });

  it("prefers the stored name once there is one", () => {
    const named = { kind: "resume" as const, createdAt: AUG_12, name: "the one that worked" };
    expect(artifactName(named, "Acme")).toBe("the one that worked");
    // A name that is only whitespace is not a name.
    expect(artifactName({ ...named, name: "   " }, "Acme")).toBe("resume_Acme_2026-08-12");
  });
});
