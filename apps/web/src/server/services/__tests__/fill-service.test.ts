import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { PIPELINE_STEPS, type Artifact, type FieldReport, type Profile } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import {
  createApplication,
  getApplication,
  updateApplication,
} from "../../repositories/application-repo";
import { createAgentTask, updateAgentTask, getAgentTask } from "../../repositories/agent-task-repo";
import { saveProfile } from "../../repositories/profile-repo";
import { upsertArtifact } from "../../repositories/artifact-repo";
import { saveJdAnalysis } from "../../repositories/jd-analysis-repo";
import { getFillHandoff } from "../../repositories/fill-handoff-repo";
import { listEvents } from "../../repositories/application-event-repo";
import { uploadResume } from "../resume-service";
import { answers, resumes } from "../../db/schema";
import {
  createHandoffForTask,
  claimHandoff,
  applyFillReport,
  resolveFill,
  completeSubmitted,
  startInstantFill,
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

const PDF_BASE64 = Buffer.from("%PDF-1.4 fake resume bytes").toString("base64");

function seedResume(over: { name: string; isPrimary?: boolean }) {
  return uploadResume(
    db,
    {
      name: over.name,
      mimeType: "application/pdf",
      dataBase64: PDF_BASE64,
      isPrimary: over.isPrimary,
    },
    { storageDir: join(dir, "resumes") },
  );
}

/** Simulates a legacy row / out-of-band deletion: a résumé that's still the
 *  application's effective selection but has no stored file on disk. */
function clearResumeFile(id: string): void {
  db.update(resumes).set({ filePath: null }).where(eq(resumes.id, id)).run();
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

describe("claimHandoff — attachResume + resumeId", () => {
  it("defaults attachResume to 'tailored' and resolves resumeId to the primary résumé", () => {
    const { taskId } = seedTaskAtFillForm();
    const primary = seedResume({ name: "Primary.pdf", isPrimary: true });
    const handoff = createHandoffForTask(db, taskId);
    const bundle = claimHandoff(db, handoff.id);
    expect(bundle.attachResume).toBe("tailored");
    expect(bundle.resumeId).toBe(primary.id);
  });

  it("resolves resumeId to the application's explicit selection over the primary", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    seedResume({ name: "Primary.pdf", isPrimary: true });
    const selected = seedResume({ name: "Selected.pdf" });
    updateApplication(db, applicationId, { resumeId: selected.id });
    const handoff = createHandoffForTask(db, taskId);
    const bundle = claimHandoff(db, handoff.id);
    expect(bundle.resumeId).toBe(selected.id);
  });

  it("carries an explicit attachResume choice from the application when the effective résumé has a stored file", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    seedResume({ name: "Primary.pdf", isPrimary: true });
    updateApplication(db, applicationId, { attachResume: "original" });
    const handoff = createHandoffForTask(db, taskId);
    const bundle = claimHandoff(db, handoff.id);
    expect(bundle.attachResume).toBe("original");
  });

  it("leaves resumeId undefined when there are no résumés at all", () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    const bundle = claimHandoff(db, handoff.id);
    expect(bundle.resumeId).toBeUndefined();
  });

  it("degrades a stale attachResume:'original' preference to 'tailored' when the effective résumé has no stored file (never a guaranteed 404)", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    const primary = seedResume({ name: "Primary.pdf", isPrimary: true });
    clearResumeFile(primary.id);
    updateApplication(db, applicationId, { attachResume: "original" });
    const handoff = createHandoffForTask(db, taskId);
    const bundle = claimHandoff(db, handoff.id);
    expect(bundle.attachResume).toBe("tailored");
  });

  it("degrades a stale attachResume:'original' preference to 'tailored' when there is no résumé at all", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    updateApplication(db, applicationId, { attachResume: "original" });
    const handoff = createHandoffForTask(db, taskId);
    const bundle = claimHandoff(db, handoff.id);
    expect(bundle.attachResume).toBe("tailored");
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

  it("appends a fill-reported event with the derived filled/needsAttention counts", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    applyFillReport(
      db,
      taskId,
      [
        report({ fieldId: "email", outcome: "filled", required: true }),
        report({ fieldId: "eeo", outcome: "needs-user", required: true }),
        report({ fieldId: "phone", outcome: "filled", required: true }),
      ],
      false,
    );
    const events = listEvents(db, applicationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "fill-reported",
      applicationId,
      payload: { filled: 2, needsAttention: 1 },
    });
  });

  it("needsAttention counts every non-filled outcome (needs-user, failed, skipped), matching fill-report-card.tsx's own 'Needs attention' bucket — not just needs-user", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    applyFillReport(
      db,
      taskId,
      [
        report({ fieldId: "email", outcome: "filled", required: true }),
        report({ fieldId: "eeo", outcome: "needs-user", required: true }),
        report({ fieldId: "visa", outcome: "failed", required: true }),
        report({ fieldId: "note", outcome: "skipped", required: false }),
      ],
      false,
    );
    const events = listEvents(db, applicationId);
    expect(events[0]?.payload).toEqual({ filled: 1, needsAttention: 3 });
  });

  it("appends a fill-reported event on every call, including a complete report", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    applyFillReport(
      db,
      taskId,
      [report({ fieldId: "email", outcome: "filled", required: true })],
      false,
    );
    applyFillReport(
      db,
      taskId,
      [report({ fieldId: "phone", outcome: "filled", required: true })],
      true,
    );
    const events = listEvents(db, applicationId);
    expect(events.map((e) => e.kind)).toEqual(["fill-reported", "fill-reported"]);
    expect(events[1]?.payload).toEqual({ filled: 2, needsAttention: 0 });
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

  it("'fixed' rewrites fieldReports so no needs-user rows remain and the report card renders them resolved", () => {
    const { taskId } = seedTaskAtFillForm();
    applyFillReport(
      db,
      taskId,
      [
        report({ fieldId: "email", outcome: "filled", required: true }),
        report({ fieldId: "eeo", outcome: "needs-user", required: true }),
        report({ fieldId: "visa", outcome: "failed", required: true }),
      ],
      true,
    );
    const task = resolveFill(db, taskId, "fixed");

    expect(task.fieldReports.some((r) => r.outcome === "needs-user")).toBe(false);
    // fill-report-card.tsx buckets by outcome === "filled" -> "Filled",
    // anything else -> "Needs attention". Every report should now land in
    // the resolved bucket.
    expect(task.fieldReports.every((r) => r.outcome === "filled")).toBe(true);
  });

  it("'fixed' clears source/value on every force-flipped row (needs-user and required-failed alike)", () => {
    const { taskId } = seedTaskAtFillForm();
    applyFillReport(
      db,
      taskId,
      [
        report({ fieldId: "email", outcome: "filled", required: true }),
        report({
          fieldId: "eeo",
          outcome: "needs-user",
          required: true,
          source: "ai-generated",
          value: "guessed value",
        }),
        report({
          fieldId: "visa",
          outcome: "failed",
          required: true,
          source: "answer-bank",
          value: "attempted value",
        }),
      ],
      true,
    );
    const task = resolveFill(db, taskId, "fixed");

    const eeo = task.fieldReports.find((r) => r.fieldId === "eeo");
    expect(eeo?.outcome).toBe("filled");
    expect(eeo?.source).toBe("none");
    expect(eeo?.value).toBeUndefined();

    // A required-failed row's value is the attempted-but-never-written value —
    // same false-provenance class as needs-user, so it gets cleared too.
    const visa = task.fieldReports.find((r) => r.fieldId === "visa");
    expect(visa?.outcome).toBe("filled");
    expect(visa?.source).toBe("none");
    expect(visa?.value).toBeUndefined();
  });

  it("'fixed' on a legacy row (applicationInfo set, fieldReports empty) merges missingFields into filledFields instead of dropping them", () => {
    const { taskId } = seedTaskAtFillForm();
    updateAgentTask(db, taskId, {
      applicationInfo: {
        status: 2,
        filledFields: ["email"],
        missingFields: ["eeo"],
        totalFields: ["email", "eeo"],
      },
      fieldReports: [],
    });

    const task = resolveFill(db, taskId, "fixed");
    expect(task.applicationInfo?.status).toBe(1);
    expect(task.applicationInfo?.missingFields ?? []).toEqual([]);
    expect(task.applicationInfo?.filledFields).toEqual(expect.arrayContaining(["email", "eeo"]));
    expect(task.applicationInfo?.totalFields).toEqual(["email", "eeo"]);
    expect(task.fieldReports).toEqual([]);
  });

  it("'fixed' leaves a non-required, non-blocking outcome untouched", () => {
    const { taskId } = seedTaskAtFillForm();
    applyFillReport(
      db,
      taskId,
      [
        report({ fieldId: "email", outcome: "filled", required: true }),
        report({ fieldId: "eeo", outcome: "needs-user", required: true }),
        report({ fieldId: "optional-note", outcome: "skipped", required: false }),
      ],
      true,
    );
    const task = resolveFill(db, taskId, "fixed");

    const optional = task.fieldReports.find((r) => r.fieldId === "optional-note");
    expect(optional?.outcome).toBe("skipped");
  });

  it("'applied-manually' finishes the task and marks the application applied with appliedAt", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    const before = Date.now();
    const task = resolveFill(db, taskId, "applied-manually");
    expect(task.status).toBe("done");
    expect(task.step).toBe(PIPELINE_STEPS.length);
    const application = getApplication(db, applicationId);
    expect(application?.status).toBe("applied");
    expect(application?.appliedAt).toBeGreaterThanOrEqual(before);
    expect(application?.appliedAt).toBeLessThanOrEqual(Date.now());
  });

  it("'applied-manually' appends a marked-submitted event", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    resolveFill(db, taskId, "applied-manually");
    const events = listEvents(db, applicationId);
    expect(events.map((e) => e.kind)).toEqual(["marked-submitted"]);
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

  it("marks the task done and the application applied (with appliedAt) at the submit gate", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    updateAgentTask(db, taskId, { step: SUBMIT_STEP, status: "awaiting_user" });
    const before = Date.now();
    const task = completeSubmitted(db, taskId);
    expect(task.status).toBe("done");
    expect(task.step).toBe(PIPELINE_STEPS.length);
    const application = getApplication(db, applicationId);
    expect(application?.status).toBe("applied");
    expect(application?.appliedAt).toBeGreaterThanOrEqual(before);
    expect(application?.appliedAt).toBeLessThanOrEqual(Date.now());
    expect(getAgentTask(db, taskId)?.status).toBe("done");
  });

  it("appends a marked-submitted event", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    updateAgentTask(db, taskId, { step: SUBMIT_STEP, status: "awaiting_user" });
    completeSubmitted(db, taskId);
    const events = listEvents(db, applicationId);
    expect(events.map((e) => e.kind)).toEqual(["marked-submitted"]);
  });
});

describe("startInstantFill", () => {
  const JOB = {
    jobId: "j-instant",
    jobTitle: "AI Engineer",
    companyName: "Forward",
    applyLink: "https://job-boards.greenhouse.io/forward/jobs/1",
  };

  it("creates the application + a fillFirst task parked at the fill gate and returns a claimed bundle", () => {
    saveProfile(db, PROFILE);
    const bundle = startInstantFill(db, { jobInfo: JOB, jdText: "Build AI features." });

    expect(bundle.job).toMatchObject({ title: "AI Engineer", company: "Forward" });
    expect(bundle.fillProfile.personal.email).toBe("jordan@example.com");

    const task = getAgentTask(db, bundle.taskId);
    expect(task?.fillFirst).toBe(true);
    expect(task?.status).toBe("awaiting_user");
    expect(PIPELINE_STEPS[task?.step ?? -1]?.key).toBe("fill-form");

    const application = getApplication(db, bundle.applicationId);
    expect(application?.jdText).toBe("Build AI features.");
    // No tailored artifact can exist yet — the application prefers the original file.
    expect(application?.attachResume).toBe("original");

    // The ticket is real and already claimed: reports/answers flow like any fill.
    expect(getFillHandoff(db, bundle.handoffId)?.status).toBe("claimed");
    expect(listEvents(db, bundle.applicationId).map((e) => e.kind)).toContain(
      "instant-fill-started",
    );
  });

  it("reports flow into the instant task exactly like the workspace lane", () => {
    const bundle = startInstantFill(db, { jobInfo: JOB });
    const report: FieldReport = {
      fieldId: "f1",
      label: "Email",
      classifiedType: "email",
      status: "fillable",
      value: "jordan@example.com",
      source: "personal",
      reason: "",
      outcome: "filled",
      required: true,
    };
    const task = applyFillReport(db, bundle.taskId, [report], true);
    expect(task.applicationInfo?.status).toBe(1);
    expect(PIPELINE_STEPS[task.step]?.key).toBe("submit");
  });

  it("reuses an existing application whose task is already awaiting fill", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    const bundle = startInstantFill(db, {
      jobInfo: { ...JOB, applyLink: "https://apply.example.com/job/1" },
    });
    expect(bundle.taskId).toBe(taskId);
    expect(bundle.applicationId).toBe(applicationId);
  });

  it("refuses a mid-pipeline application instead of fighting the workspace gates", () => {
    const { taskId } = seedTaskAtFillForm();
    updateAgentTask(db, taskId, { step: 1, status: "running" });
    expect(() =>
      startInstantFill(db, { jobInfo: { ...JOB, applyLink: "https://apply.example.com/job/1" } }),
    ).toThrow(/already tracked/);
  });

  it("refuses when the page URL is missing", () => {
    expect(() =>
      startInstantFill(db, { jobInfo: { ...JOB, applyLink: undefined } }),
    ).toThrow(/needs the page URL/);
  });
});
