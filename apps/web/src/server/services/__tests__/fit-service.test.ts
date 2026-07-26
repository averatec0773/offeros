import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Artifact, JdAnalysis, Profile } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import { createApplication } from "../../repositories/application-repo";
import { createAgentTask } from "../../repositories/agent-task-repo";
import { getAgentTaskByApplicationId } from "../../repositories/agent-task-by-application";
import { saveProfile } from "../../repositories/profile-repo";
import { saveJdAnalysis } from "../../repositories/jd-analysis-repo";
import { upsertArtifact } from "../../repositories/artifact-repo";
import { getFit } from "../../repositories/fit-repo";
import { computeFit, computeSkillOverlap } from "../fit-service";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-fit-service-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const PROFILE: Profile = {
  personal: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "555-0100",
    city: "Austin",
    state: "TX",
    links: { linkedin: "https://linkedin.com/in/jordan" },
  },
  skills: ["Python", "Machine Learning", "TypeScript"],
  education: [],
  experience: [
    {
      id: "x1",
      company: "Acme",
      title: "ML Engineer",
      start: "2021",
      end: "Present",
      bullets: ["Led the ML pipeline redesign"],
    },
  ],
};

const JD_ANALYSIS = (applicationId: string): JdAnalysis => ({
  id: "jda-1",
  applicationId,
  summary: "ML Engineer role",
  responsibilities: ["Build models"],
  requiredSkills: ["Python", "Kubernetes"],
  preferredSkills: ["Machine Learning", "Go"],
  matchNotes: [],
  gaps: [],
  coverLetterRequirement: "optional",
  createdAt: Date.now(),
});

const FIT_OUTPUT = {
  overall: 82,
  label: "Strong match",
  subScores: { experience: 80, skills: 85, education: 70 },
  whyMatch: "Solid Python and ML background.",
  alignedSkills: [{ skill: "Python", evidence: "Led ML pipeline" }],
  notAlignedSkills: [{ skill: "Kubernetes", advice: "Take a k8s course" }],
};

function seed(): { applicationId: string } {
  const app = createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
    jdText: "We are hiring an ML Engineer.",
  });
  saveProfile(db, PROFILE);
  createAgentTask(db, { applicationId: app.id });
  saveJdAnalysis(db, JD_ANALYSIS(app.id));
  return { applicationId: app.id };
}

describe("computeSkillOverlap", () => {
  it("credits met required+preferred skills as matched and only required gaps as missing", () => {
    const overlap = computeSkillOverlap(PROFILE.skills, JD_ANALYSIS("a"));
    // Python (required) + Machine Learning (preferred) are present.
    expect(overlap.matched).toEqual(["Python", "Machine Learning"]);
    // Only the unmet REQUIRED skill is a gap; unmet preferred (Go) is not.
    expect(overlap.missing).toEqual(["Kubernetes"]);
  });

  it("returns empty overlap when there is no jd analysis", () => {
    expect(computeSkillOverlap(PROFILE.skills, null)).toEqual({ matched: [], missing: [] });
  });
});

describe("computeFit", () => {
  it("feeds the deterministic overlap to the prompt and stores the tolerant output", async () => {
    const { applicationId } = seed();
    let capturedInput: { skillOverlap?: { matched: string[]; missing: string[] } } = {};
    const runLlm = async (taskId: string, input: unknown) => {
      expect(taskId).toBe("fit-analysis");
      capturedInput = input as typeof capturedInput;
      return FIT_OUTPUT;
    };

    const fit = await computeFit(db, applicationId, { runLlm });

    // The deterministic overlap reached the prompt input.
    expect(capturedInput.skillOverlap).toEqual({
      matched: ["Python", "Machine Learning"],
      missing: ["Kubernetes"],
    });

    // Persistence fields attached; narrative stored.
    expect(fit.applicationId).toBe(applicationId);
    expect(fit.version).toBe(1);
    expect(fit.overall).toBe(82);
    expect(fit.label).toBe("Strong match");
    expect(fit.id).toBeTruthy();
    expect(fit.createdAt).toBeTruthy();

    const persisted = getFit(db, applicationId);
    expect(persisted?.overall).toBe(82);
    expect(persisted?.notAlignedSkills[0]?.skill).toBe("Kubernetes");
  });

  it("uses the current résumé artifact text as resumeText when one exists", async () => {
    const { applicationId } = seed();
    const task = getAgentTaskByApplicationId(db, applicationId)!;
    const now = Date.now();
    const artifact: Artifact = {
      id: "art-1",
      taskId: task.id,
      kind: "resume",
      versions: [{ id: "v1", content: "TAILORED RESUME BODY", rationale: "", createdAt: now }],
      currentVersionId: "v1",
      createdAt: now,
      updatedAt: now,
    };
    upsertArtifact(db, artifact);

    let capturedResume = "";
    const runLlm = async (_taskId: string, input: unknown) => {
      capturedResume = (input as { resumeText: string }).resumeText;
      return FIT_OUTPUT;
    };
    await computeFit(db, applicationId, { runLlm });
    expect(capturedResume).toBe("TAILORED RESUME BODY");
  });

  it("recompute replaces the row rather than appending (one row per application)", async () => {
    const { applicationId } = seed();
    const runLlm = async () => FIT_OUTPUT;
    const first = await computeFit(db, applicationId, { runLlm });
    const runLlm2 = async () => ({ ...FIT_OUTPUT, overall: 40, label: "Partial match" });
    const second = await computeFit(db, applicationId, { runLlm: runLlm2 });

    // Same id, createdAt preserved; content replaced.
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.overall).toBe(40);
    const persisted = getFit(db, applicationId);
    expect(persisted?.overall).toBe(40);
  });

  it("throws when the application does not exist", async () => {
    await expect(computeFit(db, "missing", { runLlm: async () => FIT_OUTPUT })).rejects.toThrow();
  });
});
