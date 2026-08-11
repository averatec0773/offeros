import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { createApplication } from "../application-repo";
import { createPipelineTask, updatePipelineTask } from "../pipeline-task-repo";
import { getPipelineTaskByApplicationId } from "../pipeline-task-by-application";
import { getJdAnalysis, saveJdAnalysis } from "../jd-analysis-repo";
import { getArtifact, listArtifacts, upsertArtifact } from "../artifact-repo";
import { getFit, saveFit, listFits } from "../fit-repo";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-pipeline-repo-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function makeApplication(db: Db) {
  return createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver" },
  });
}

describe("jd-analysis repo", () => {
  it("returns null before anything is saved, then round-trips", () => {
    const app = makeApplication(db);
    expect(getJdAnalysis(db, app.id)).toBeNull();

    const saved = saveJdAnalysis(db, {
      id: "jda-1",
      applicationId: app.id,
      summary: "Great fit",
      responsibilities: ["Ship features"],
      requiredSkills: ["TypeScript"],
      preferredSkills: [],
      matchNotes: [],
      gaps: [],
      coverLetterRequirement: "required",
      createdAt: Date.now(),
    });
    expect(saved.summary).toBe("Great fit");
    expect(getJdAnalysis(db, app.id)?.requiredSkills).toEqual(["TypeScript"]);
  });

  it("overwrites the analysis for a given application rather than inserting twice", () => {
    const app = makeApplication(db);
    saveJdAnalysis(db, {
      id: "jda-1",
      applicationId: app.id,
      summary: "First pass",
      responsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      matchNotes: [],
      gaps: [],
      coverLetterRequirement: "unknown",
      createdAt: Date.now(),
    });
    saveJdAnalysis(db, {
      id: "jda-2",
      applicationId: app.id,
      summary: "Second pass",
      responsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      matchNotes: [],
      gaps: [],
      coverLetterRequirement: "required",
      createdAt: Date.now(),
    });
    expect(getJdAnalysis(db, app.id)?.summary).toBe("Second pass");
  });
});

describe("artifact repo", () => {
  it("upserts, keeps the latest version, and lists by task", () => {
    const app = makeApplication(db);
    const task = createPipelineTask(db, { applicationId: app.id });
    const now = Date.now();

    upsertArtifact(db, {
      id: "art-1",
      taskId: task.id,
      kind: "cover-letter",
      versions: [{ id: "v1", content: "Dear hiring manager,", rationale: "", createdAt: now }],
      currentVersionId: "v1",
      createdAt: now,
      updatedAt: now,
    });

    const updated = upsertArtifact(db, {
      id: "art-1",
      taskId: task.id,
      kind: "cover-letter",
      versions: [
        { id: "v1", content: "Dear hiring manager,", rationale: "", createdAt: now },
        { id: "v2", content: "Dear team,", rationale: "shorter opener", createdAt: now + 1 },
      ],
      currentVersionId: "v2",
      createdAt: now,
      updatedAt: now + 1,
    });
    expect(updated.versions).toHaveLength(2);

    const fetched = getArtifact(db, task.id, "cover-letter");
    expect(fetched?.currentVersionId).toBe("v2");
    expect(fetched?.versions).toHaveLength(2);
    expect(getArtifact(db, task.id, "resume")).toBeNull();
    expect(listArtifacts(db, task.id)).toHaveLength(1);
  });
});

describe("pipeline-task-by-application helper", () => {
  it("returns the task for an application id", () => {
    const app = makeApplication(db);
    const task = createPipelineTask(db, { applicationId: app.id });
    expect(getPipelineTaskByApplicationId(db, app.id)?.id).toBe(task.id);
    expect(getPipelineTaskByApplicationId(db, "nope")).toBeNull();
  });
});

describe("agent_tasks cover-letter columns", () => {
  it("persist through create and update", () => {
    const app = makeApplication(db);
    const task = createPipelineTask(db, { applicationId: app.id });
    expect(task.coverLetterRequirement).toBe("unknown");
    expect(task.skippedCoverLetter).toBe(false);

    const updated = updatePipelineTask(db, task.id, {
      coverLetterRequirement: "required",
      skippedCoverLetter: true,
    });
    expect(updated?.coverLetterRequirement).toBe("required");
    expect(updated?.skippedCoverLetter).toBe(true);

    const reloaded = getPipelineTaskByApplicationId(db, app.id);
    expect(reloaded?.coverLetterRequirement).toBe("required");
    expect(reloaded?.skippedCoverLetter).toBe(true);
  });
});

describe("fit repo", () => {
  it("returns null before anything is saved, then round-trips", () => {
    const app = makeApplication(db);
    expect(getFit(db, app.id)).toBeNull();

    const saved = saveFit(db, {
      id: "fit-1",
      applicationId: app.id,
      version: 1,
      overall: 77,
      label: "Good match",
      subScores: { experience: 70, skills: 80, education: 60 },
      whyMatch: "Solid overlap",
      alignedSkills: [{ skill: "TypeScript", evidence: "5 years" }],
      notAlignedSkills: [{ skill: "Rust", advice: "Learn it" }],
      createdAt: 1000,
    });
    expect(saved.overall).toBe(77);
    expect(getFit(db, app.id)?.overall).toBe(77);
  });

  it("upserts keyed by applicationId: replace, not append", () => {
    const app = makeApplication(db);
    saveFit(db, {
      id: "fit-1",
      applicationId: app.id,
      version: 1,
      overall: 50,
      label: "Partial",
      subScores: { experience: 50, skills: 50, education: 50 },
      whyMatch: "first",
      alignedSkills: [],
      notAlignedSkills: [],
      createdAt: 1000,
    });
    saveFit(db, {
      id: "fit-2",
      applicationId: app.id,
      version: 1,
      overall: 90,
      label: "Strong",
      subScores: { experience: 90, skills: 90, education: 90 },
      whyMatch: "second",
      alignedSkills: [],
      notAlignedSkills: [],
      createdAt: 2000,
    });

    const reloaded = getFit(db, app.id);
    expect(reloaded?.id).toBe("fit-2");
    expect(reloaded?.overall).toBe(90);
    expect(reloaded?.whyMatch).toBe("second");
  });

  it("same-id re-save is atomic and keeps a single row (reused-id upsert path)", () => {
    const app = makeApplication(db);
    const base = {
      id: "fit-stable",
      applicationId: app.id,
      version: 1 as const,
      subScores: { experience: 50, skills: 50, education: 50 },
      whyMatch: "x",
      alignedSkills: [],
      notAlignedSkills: [],
      createdAt: 1000,
    };
    saveFit(db, { ...base, overall: 60, label: "First" });
    // Recompute reuses the existing id; the delete+insert must be atomic so this
    // same-id path never PK-violates and never appends a second row.
    expect(() => saveFit(db, { ...base, overall: 88, label: "Second" })).not.toThrow();
    const reloaded = getFit(db, app.id);
    expect(reloaded?.id).toBe("fit-stable");
    expect(reloaded?.overall).toBe(88);
    expect(listFits(db).filter((f) => f.applicationId === app.id)).toHaveLength(1);
  });

  it("listFits: returns a row per application with a saved fit, none for those without", () => {
    const withFit = makeApplication(db);
    const withoutFit = makeApplication(db);
    saveFit(db, {
      id: "fit-1",
      applicationId: withFit.id,
      version: 1,
      overall: 82,
      label: "Strong match",
      subScores: { experience: 80, skills: 85, education: 70 },
      whyMatch: "Solid overlap",
      alignedSkills: [],
      notAlignedSkills: [],
      createdAt: 1000,
    });

    const fits = listFits(db);
    expect(fits.map((f) => f.applicationId)).toContain(withFit.id);
    expect(fits.map((f) => f.applicationId)).not.toContain(withoutFit.id);
  });
});
