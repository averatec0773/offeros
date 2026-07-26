import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPELINE_STEPS, type Artifact, type FieldReport, type Profile } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import { createApplication, getApplication } from "../../repositories/application-repo";
import { createAgentTask, updateAgentTask, getAgentTask } from "../../repositories/agent-task-repo";
import { saveProfile } from "../../repositories/profile-repo";
import { upsertArtifact } from "../../repositories/artifact-repo";
import { saveJdAnalysis } from "../../repositories/jd-analysis-repo";
import { getFillHandoff } from "../../repositories/fill-handoff-repo";
import { answers } from "../../db/schema";
import {
  createHandoffForTask,
  claimHandoff,
  applyFillReport,
  resolveFill,
  completeSubmitted,
  ServiceError,
} from "../fill-service";

const FILL_FORM_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "fill-form");
const SUBMIT_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "submit");

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-fill-service-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const PROFILE: Profile = {
  personal: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "555-0100",
    city: "Austin",
    links: { linkedin: "https://linkedin.com/in/jordan" },
  },
  skills: ["Python", "TypeScript"],
  education: [],
  experience: [],
};

function seedTaskAtFillForm(): { taskId: string; applicationId: string } {
  const app = createApplication(db, {
    jobInfo: {
      jobId: "j1",
      jobTitle: "GenAI Engineer",
      companyName: "Evolver",
      applyLink: "https://apply.example.com/job/1",
    },
  });
  const task = createAgentTask(db, { applicationId: app.id });
  updateAgentTask(db, task.id, { step: FILL_FORM_STEP, status: "awaiting_user" });
  return { taskId: task.id, applicationId: app.id };
}

function seedAnswer(entry: {
  id: string;
  questionPatterns: string[];
  answer: string;
  type: "enum" | "text" | "number" | "boolean";
  category: "eeo" | "screening" | "custom";
}) {
  db.insert(answers).values({ id: entry.id, doc: entry, updatedAt: Date.now() }).run();
}

function seedArtifact(taskId: string, kind: "resume" | "cover-letter", content: string): Artifact {
  const now = Date.now();
  const artifact: Artifact = {
    id: `${taskId}-${kind}`,
    taskId,
    kind,
    versions: [
      { id: "v1", content: "stale", rationale: "", createdAt: now - 1 },
      { id: "v2", content, rationale: "", createdAt: now },
    ],
    currentVersionId: "v2",
    createdAt: now,
    updatedAt: now,
  };
  return upsertArtifact(db, artifact);
}

function report(over: Partial<FieldReport> & Pick<FieldReport, "fieldId">): FieldReport {
  return {
    label: over.label ?? over.fieldId,
    classifiedType: "unknown",
    status: "filled",
    source: "personal",
    reason: "",
    outcome: "filled",
    required: true,
    ...over,
  };
}

describe("createHandoffForTask", () => {
  it("throws when the task is not awaiting_user at fill-form", () => {
    const { taskId } = seedTaskAtFillForm();
    updateAgentTask(db, taskId, { status: "running" });
    expect(() => createHandoffForTask(db, taskId)).toThrow(ServiceError);
  });

  it("throws when the task is not at the fill-form step", () => {
    const { taskId } = seedTaskAtFillForm();
    updateAgentTask(db, taskId, { step: 0, status: "awaiting_user" });
    expect(() => createHandoffForTask(db, taskId)).toThrow(ServiceError);
  });

  it("creates a pending handoff carrying the apply link", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    expect(handoff.status).toBe("pending");
    expect(handoff.taskId).toBe(taskId);
    expect(handoff.applicationId).toBe(applicationId);
    expect(handoff.applyLink).toBe("https://apply.example.com/job/1");
  });
});

describe("claimHandoff", () => {
  it("transitions pending → claimed and returns the fill bundle", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    saveProfile(db, PROFILE);
    seedAnswer({
      id: "ans1",
      questionPatterns: ["authorized to work"],
      answer: "Yes",
      type: "boolean",
      category: "screening",
    });
    seedArtifact(taskId, "resume", "TAILORED RESUME BODY");
    seedArtifact(taskId, "cover-letter", "COVER LETTER BODY");
    saveJdAnalysis(db, {
      id: "jd1",
      applicationId,
      summary: "Build GenAI systems.",
      responsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      matchNotes: [],
      gaps: [],
      coverLetterRequirement: "optional",
      createdAt: Date.now(),
    });

    const handoff = createHandoffForTask(db, taskId);
    const bundle = claimHandoff(db, handoff.id);

    expect(getFillHandoff(db, handoff.id)?.status).toBe("claimed");
    expect(bundle.handoffId).toBe(handoff.id);
    expect(bundle.taskId).toBe(taskId);
    expect(bundle.applicationId).toBe(applicationId);
    expect(bundle.job).toEqual({
      title: "GenAI Engineer",
      company: "Evolver",
      applyLink: "https://apply.example.com/job/1",
    });
    expect(bundle.fillProfile.personal.name).toBe("Jordan Rivera");
    expect(bundle.fillProfile.personal.address).toBe("");
    expect(bundle.fillProfile.personal.city).toBe("Austin");
    expect(bundle.fillProfile.skills).toEqual(["Python", "TypeScript"]);
    expect(bundle.fillProfile.answerBank).toHaveLength(1);
    expect(bundle.fillProfile.answerBank[0]?.id).toBe("ans1");
    expect(bundle.resumeText).toBe("TAILORED RESUME BODY");
    expect(bundle.coverLetterText).toBe("COVER LETTER BODY");
    expect(bundle.jdSummary).toBe("Build GenAI systems.");
  });

  it("returns null artifact text when resume/cover-letter absent", () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    const bundle = claimHandoff(db, handoff.id);
    expect(bundle.resumeText).toBeNull();
    expect(bundle.coverLetterText).toBeNull();
    expect(bundle.jdSummary).toBeNull();
  });

  it("returns null cover-letter text when the task skipped it", () => {
    const { taskId } = seedTaskAtFillForm();
    seedArtifact(taskId, "cover-letter", "SHOULD BE HIDDEN");
    updateAgentTask(db, taskId, { skippedCoverLetter: true });
    const handoff = createHandoffForTask(db, taskId);
    const bundle = claimHandoff(db, handoff.id);
    expect(bundle.coverLetterText).toBeNull();
  });

  it("throws when claiming a non-pending ticket", () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    claimHandoff(db, handoff.id);
    expect(() => claimHandoff(db, handoff.id)).toThrow(ServiceError);
  });

  it("throws when the ticket does not exist", () => {
    expect(() => claimHandoff(db, "nope")).toThrow(ServiceError);
  });
});

describe("applyFillReport", () => {
  it("merges reports and derives applicationInfo without transitioning when incomplete", () => {
    const { taskId } = seedTaskAtFillForm();
    const first = applyFillReport(db, taskId, [report({ fieldId: "email" })], false);
    expect(first.step).toBe(FILL_FORM_STEP);
    expect(first.status).toBe("awaiting_user");
    expect(first.fieldReports.map((r) => r.fieldId)).toEqual(["email"]);
    expect(first.applicationInfo?.filledFields).toEqual(["email"]);

    const second = applyFillReport(db, taskId, [report({ fieldId: "phone" })], false);
    expect(second.step).toBe(FILL_FORM_STEP);
    expect(second.fieldReports.map((r) => r.fieldId)).toEqual(["email", "phone"]);
  });

  it("advances to the submit gate when complete and everything is filled (status 1)", () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    const task = applyFillReport(db, taskId, [report({ fieldId: "email" })], true);
    expect(task.applicationInfo?.status).toBe(1);
    expect(task.step).toBe(SUBMIT_STEP);
    expect(task.status).toBe("awaiting_user");
    expect(getFillHandoff(db, handoff.id)?.status).toBe("completed");
  });

  it("stays at fill-form as Action Required when complete with missing required fields (status 2)", () => {
    const { taskId } = seedTaskAtFillForm();
    const task = applyFillReport(
      db,
      taskId,
      [
        report({ fieldId: "email", outcome: "filled", required: true }),
        report({ fieldId: "eeo", outcome: "needs-user", required: true }),
      ],
      true,
    );
    expect(task.applicationInfo?.status).toBe(2);
    expect(task.applicationInfo?.missingFields).toEqual(["eeo"]);
    expect(task.step).toBe(FILL_FORM_STEP);
    expect(task.status).toBe("awaiting_user");
  });
});

describe("resolveFill", () => {
  it("'fixed' clears missing into filled, sets status 1, advances to submit gate", () => {
    const { taskId } = seedTaskAtFillForm();
    applyFillReport(
      db,
      taskId,
      [
        report({ fieldId: "email", outcome: "filled", required: true }),
        report({ fieldId: "eeo", outcome: "needs-user", required: true }),
      ],
      true,
    );
    const task = resolveFill(db, taskId, "fixed");
    expect(task.applicationInfo?.status).toBe(1);
    expect(task.applicationInfo?.missingFields ?? []).toEqual([]);
    expect(task.applicationInfo?.filledFields).toEqual(expect.arrayContaining(["email", "eeo"]));
    expect(task.step).toBe(SUBMIT_STEP);
    expect(task.status).toBe("awaiting_user");
  });

  it("'applied-manually' finishes the task and marks the application applied", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    const task = resolveFill(db, taskId, "applied-manually");
    expect(task.status).toBe("done");
    expect(task.step).toBe(PIPELINE_STEPS.length);
    expect(getApplication(db, applicationId)?.status).toBe("applied");
  });

  it("'fixed' completes an open claimed handoff (does not leave it open forever)", () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    claimHandoff(db, handoff.id); // → claimed (still open)
    // Incremental report (complete=false) leaving a required field outstanding →
    // status 2, handoff stays open (applyFillReport only closes on complete=true).
    applyFillReport(
      db,
      taskId,
      [
        report({ fieldId: "email", outcome: "filled", required: true }),
        report({ fieldId: "eeo", outcome: "needs-user", required: true }),
      ],
      false,
    );
    expect(getFillHandoff(db, handoff.id)?.status).toBe("claimed");

    const task = resolveFill(db, taskId, "fixed");
    expect(task.applicationInfo?.status).toBe(1);
    expect(getFillHandoff(db, handoff.id)?.status).toBe("completed");
  });

  it("'applied-manually' completes an open claimed handoff", () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    claimHandoff(db, handoff.id); // → claimed (still open)
    resolveFill(db, taskId, "applied-manually");
    expect(getFillHandoff(db, handoff.id)?.status).toBe("completed");
  });
});

describe("completeSubmitted", () => {
  it("throws unless the task is awaiting_user at the submit step", () => {
    const { taskId } = seedTaskAtFillForm();
    expect(() => completeSubmitted(db, taskId)).toThrow(ServiceError);
  });

  it("marks the task done and the application applied at the submit gate", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    updateAgentTask(db, taskId, { step: SUBMIT_STEP, status: "awaiting_user" });
    const task = completeSubmitted(db, taskId);
    expect(task.status).toBe("done");
    expect(task.step).toBe(PIPELINE_STEPS.length);
    expect(getApplication(db, applicationId)?.status).toBe("applied");
    expect(getAgentTask(db, taskId)?.status).toBe("done");
  });
});
