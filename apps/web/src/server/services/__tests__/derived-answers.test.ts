import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPELINE_STEPS } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import { createApplication } from "../../repositories/application-repo";
import { createPipelineTask, updatePipelineTask } from "../../repositories/pipeline-task-repo";
import { saveProfile } from "../../repositories/profile-repo";
import { createHandoffForTask, claimHandoff } from "../fill-service";

const FILL_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "fill-form");

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-derived-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seedBundle(jdText: string) {
  const app = createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "AI Engineer", companyName: "Acme" },
    jdText,
  });
  const task = createPipelineTask(db, { applicationId: app.id });
  updatePipelineTask(db, task.id, { step: FILL_STEP, status: "awaiting_user" });
  const handoff = createHandoffForTask(db, task.id);
  return claimHandoff(db, handoff.id);
}

const PROFILE = {
  personal: { name: "Jordan Rivera", email: "j@example.com", phone: "", links: {} },
  skills: ["Python"],
  education: [],
  experience: [],
  evidence: [
    {
      id: "rag",
      title: "Internal doc search",
      url: "https://github.com/example/rag",
      summary: "Retrieval pipeline with an evaluation harness",
      stack: ["Python", "RAG"],
      outcome: "Cut answer latency to 900ms",
    },
    {
      id: "css",
      title: "Design system",
      url: "https://example.com/ds",
      summary: "Component library",
      stack: ["CSS"],
      outcome: "",
    },
  ],
  selfAssessments: [{ id: "py", topic: "Python", level: "High", note: "" }],
};

describe("derived answers in the fill bundle", () => {
  it("answers 'links to relevant work' with the projects that match THIS job", () => {
    saveProfile(db, PROFILE);
    const bundle = seedBundle("We build RAG systems in Python.");
    const entry = bundle.fillProfile.answerBank.find((a) => a.id === "derived:evidence");
    expect(entry).toBeTruthy();
    expect(entry!.answer).toContain("https://github.com/example/rag");
    expect(entry!.answer).toContain("Cut answer latency to 900ms");
    // The unrelated project is left out rather than padding the answer.
    expect(entry!.answer).not.toContain("Design system");
  });

  it("answers a rating question from the committed level, so applications agree", () => {
    saveProfile(db, PROFILE);
    const bundle = seedBundle("Python role");
    const entry = bundle.fillProfile.answerBank.find((a) => a.id === "derived:self-assessment:py");
    expect(entry?.answer).toBe("High");
    expect(entry?.derived).toBe(true);
    // The patterns carry a rating cue rather than the bare topic: "Python" on
    // its own would answer any question containing the word.
    expect(entry!.questionPatterns).toContain("rate your Python");
    expect(entry!.questionPatterns).not.toContain("Python");
  });

  it("lets a stored answer win over a derived one", () => {
    saveProfile(db, PROFILE);
    const bundle = seedBundle("We build RAG systems in Python.");
    const ids = bundle.fillProfile.answerBank.map((a) => a.id);
    // Stored entries are listed first; matchAnswer resolves ties by pattern
    // length, and precedence here is what keeps a user's own words in front.
    expect(ids.indexOf("derived:evidence")).toBe(ids.length - 2);
  });

  it("derives nothing when the profile has no evidence or ratings", () => {
    saveProfile(db, { ...PROFILE, evidence: [], selfAssessments: [] });
    const bundle = seedBundle("Python role");
    expect(bundle.fillProfile.answerBank.filter((a) => a.id.startsWith("derived:"))).toEqual([]);
  });

  it("survives a profile saved before these fields existed", () => {
    saveProfile(db, {
      personal: PROFILE.personal,
      skills: [],
      education: [],
      experience: [],
    });
    expect(() => seedBundle("Python role")).not.toThrow();
  });
});
