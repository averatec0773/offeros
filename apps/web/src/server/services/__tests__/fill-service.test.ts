import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { PIPELINE_STEPS, type Artifact, type FieldReport, type Profile } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import {
  createApplication,
  getApplication,
  updateApplication,
} from "../../repositories/application-repo";
import {
  createPipelineTask,
  updatePipelineTask,
  getPipelineTask,
} from "../../repositories/pipeline-task-repo";
import { saveProfile } from "../../repositories/profile-repo";
import { upsertArtifact } from "../../repositories/artifact-repo";
import { saveJdAnalysis } from "../../repositories/jd-analysis-repo";
import { getFillHandoff, listOpenFillHandoffs } from "../../repositories/fill-handoff-repo";
import { listEvents } from "../../repositories/application-event-repo";
import { uploadResume } from "../resume-service";
import { answers, resumes } from "../../db/schema";
import {
  createHandoffForTask,
  claimHandoff,
  applyFillReport,
  resolveFill,
  completeSubmitted,
  isCurrentClaim,
  markSubmitted,
  undoSubmitted,
  undoSubmittedForApplication,
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
  const task = createPipelineTask(db, { applicationId: app.id });
  updatePipelineTask(db, task.id, { step: FILL_FORM_STEP, status: "awaiting_user" });
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
    updatePipelineTask(db, taskId, { status: "running" });
    expect(() => createHandoffForTask(db, taskId)).toThrow(ServiceError);
  });

  it("throws when the task is not at the fill-form step", () => {
    const { taskId } = seedTaskAtFillForm();
    updatePipelineTask(db, taskId, { step: 0, status: "awaiting_user" });
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
    updatePipelineTask(db, taskId, { skippedCoverLetter: true });
    const handoff = createHandoffForTask(db, taskId);
    const bundle = claimHandoff(db, handoff.id);
    expect(bundle.coverLetterText).toBeNull();
  });

  it("re-claiming a claimed ticket is idempotent (panel-reload recovery); closed tickets throw", () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    claimHandoff(db, handoff.id);
    expect(claimHandoff(db, handoff.id).taskId).toBe(taskId);
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
    // Note the counts below: the complete report carried only "phone", and a
    // complete report REPLACES rather than merges, so "email" is gone. That is
    // the intended semantics — the panel always sends its whole accumulated
    // set on Done, so anything absent from it genuinely no longer exists.
    //
    // The complete call additionally leaves the form-memory idempotency
    // marker (see rememberForm) — the reports these test fixtures use carry
    // no questionKey, so memory records nothing, but the marker still lands.
    expect(events.map((e) => e.kind)).toEqual([
      "fill-reported",
      "fill-reported",
      "form-memory-recorded",
    ]);
    expect(events[1]?.payload).toEqual({ filled: 1, needsAttention: 0 });
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
    updatePipelineTask(db, taskId, {
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
    updatePipelineTask(db, taskId, { step: SUBMIT_STEP, status: "awaiting_user" });
    const before = Date.now();
    const task = completeSubmitted(db, taskId);
    expect(task.status).toBe("done");
    expect(task.step).toBe(PIPELINE_STEPS.length);
    const application = getApplication(db, applicationId);
    expect(application?.status).toBe("applied");
    expect(application?.appliedAt).toBeGreaterThanOrEqual(before);
    expect(application?.appliedAt).toBeLessThanOrEqual(Date.now());
    expect(getPipelineTask(db, taskId)?.status).toBe("done");
  });

  it("appends a marked-submitted event", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    updatePipelineTask(db, taskId, { step: SUBMIT_STEP, status: "awaiting_user" });
    completeSubmitted(db, taskId);
    const events = listEvents(db, applicationId);
    expect(events.map((e) => e.kind)).toEqual(["marked-submitted"]);
  });
});

describe("undoSubmitted", () => {
  it("throws when the task isn't completed", () => {
    const { taskId } = seedTaskAtFillForm();
    expect(() => undoSubmitted(db, taskId)).toThrow(ServiceError);
  });

  it("restores an applied-manually completion to the fill-form gate and un-applies the application", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    resolveFill(db, taskId, "applied-manually");

    const task = undoSubmitted(db, taskId);
    expect(task.status).toBe("awaiting_user");
    expect(task.step).toBe(FILL_FORM_STEP);
    const application = getApplication(db, applicationId);
    // Restored from the ledger payload: the application returns to the exact
    // status it held before the mis-click (the seed creates it as "saved").
    expect(application?.status).toBe("saved");
    expect(application?.appliedAt).toBeUndefined();
    expect(listEvents(db, applicationId).map((e) => e.kind)).toEqual([
      "marked-submitted",
      "submission-undone",
    ]);
  });

  it("restores a submit-gate completion to the submit gate", () => {
    const { taskId } = seedTaskAtFillForm();
    updatePipelineTask(db, taskId, { step: SUBMIT_STEP, status: "awaiting_user" });
    completeSubmitted(db, taskId);

    const task = undoSubmitted(db, taskId);
    expect(task.status).toBe("awaiting_user");
    expect(task.step).toBe(SUBMIT_STEP);
  });

  it("legacy completions without a payload restore to the submit gate", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    resolveFill(db, taskId, "applied-manually");
    // Simulate a pre-payload ledger: strip the payloads from the recorded events.
    for (const e of listEvents(db, applicationId)) {
      db.run(sql`UPDATE application_events SET payload = NULL WHERE id = ${e.id}`);
    }
    const task = undoSubmitted(db, taskId);
    expect(task.status).toBe("awaiting_user");
    expect(task.step).toBe(SUBMIT_STEP);
    expect(getApplication(db, applicationId)?.status).toBe("applying");
  });

  it("mark → undo → mark again round-trips cleanly", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    resolveFill(db, taskId, "applied-manually");
    undoSubmitted(db, taskId);
    const again = resolveFill(db, taskId, "applied-manually");
    expect(again.status).toBe("done");
    expect(getApplication(db, applicationId)?.status).toBe("applied");
  });
});

describe("claimHandoff — re-claim resilience", () => {
  it("re-claiming a claimed ticket is idempotent and carries the task's fieldReports", () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    const first = claimHandoff(db, handoff.id);
    expect(first.fieldReports).toEqual([]);

    const report: FieldReport = {
      fieldId: "f1",
      label: "Email",
      classifiedType: "email",
      status: "fillable",
      value: "a@b.com",
      source: "personal",
      reason: "",
      outcome: "filled",
      required: true,
    };
    applyFillReport(db, taskId, [report], false);

    // The panel reloaded and claims the SAME ticket again — allowed, and the
    // bundle now carries the accumulated reports for rehydration.
    const second = claimHandoff(db, handoff.id);
    expect(second.taskId).toBe(taskId);
    expect(second.fieldReports.map((r) => r.fieldId)).toEqual(["f1"]);
    expect(getFillHandoff(db, handoff.id)?.status).toBe("claimed");
  });

  it("still refuses completed and cancelled tickets", () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    claimHandoff(db, handoff.id);
    applyFillReport(
      db,
      taskId,
      [
        {
          fieldId: "f1",
          label: "Email",
          classifiedType: "email",
          status: "fillable",
          value: "a@b.com",
          source: "personal",
          reason: "",
          outcome: "filled",
          required: true,
        },
      ],
      true,
    );
    expect(getFillHandoff(db, handoff.id)?.status).toBe("completed");
    expect(() => claimHandoff(db, handoff.id)).toThrow(ServiceError);
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

    const task = getPipelineTask(db, bundle.taskId);
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

  it("refuses a mid-pipeline application instead of fighting the state gates", () => {
    const { taskId } = seedTaskAtFillForm();
    updatePipelineTask(db, taskId, { step: 1, status: "running" });
    expect(() =>
      startInstantFill(db, { jobInfo: { ...JOB, applyLink: "https://apply.example.com/job/1" } }),
    ).toThrow(/already in OfferOS/);
  });

  it("refuses when the page URL is missing", () => {
    expect(() => startInstantFill(db, { jobInfo: { ...JOB, applyLink: undefined } })).toThrow(
      /needs the page URL/,
    );
  });
});

describe("report merge semantics (the stale needs-you defect)", () => {
  const field = (over: Partial<FieldReport>): FieldReport => ({
    fieldId: "f1",
    label: "Field",
    classifiedType: "unknown",
    status: "filled",
    source: "personal",
    reason: "",
    outcome: "filled",
    required: false,
    page: "boards.example.com/acme/apply",
    ...over,
  });

  function parkedTask() {
    const application = createApplication(db, {
      jobInfo: { jobId: "j1", jobTitle: "Engineer", companyName: "Acme" },
    });
    const task = createPipelineTask(db, {
      applicationId: application.id,
      status: "awaiting_user",
      step: PIPELINE_STEPS.findIndex((s) => s.key === "fill-form"),
    });
    return task.id;
  }

  it("replaces the whole set on a complete report, so nothing outlives the run", () => {
    const taskId = parkedTask();
    // An earlier run left a field needing the user.
    applyFillReport(
      db,
      taskId,
      [field({ fieldId: "why-us", outcome: "needs-user", required: true, status: "skipped" })],
      false,
    );
    expect(getPipelineTask(db, taskId)!.applicationInfo?.status).toBe(2);

    // The user answers it and finishes. The complete report is the panel's
    // whole accumulated snapshot — anything absent from it no longer exists.
    const after = applyFillReport(
      db,
      taskId,
      [field({ fieldId: "why-us", outcome: "filled", required: true, value: "Because." })],
      true,
    );

    expect(after.fieldReports).toHaveLength(1);
    expect(after.fieldReports[0]!.outcome).toBe("filled");
    expect(after.applicationInfo?.status).toBe(1);
  });

  it("heals rows left behind by the old unstable page key, with no migration", () => {
    const taskId = parkedTask();
    // What the old field-set-hash key produced: the same field recorded twice
    // under two different "pages", the stale copy still needing the user.
    applyFillReport(
      db,
      taskId,
      [
        field({ fieldId: "why-us", page: "f1|f2|f3", outcome: "needs-user", status: "skipped" }),
        field({ fieldId: "why-us", page: "f1|f2|f3|f4", outcome: "needs-user", status: "skipped" }),
      ],
      false,
    );
    expect(getPipelineTask(db, taskId)!.fieldReports).toHaveLength(2);

    // One complete fill with stable keys, and the duplicates are simply gone.
    const after = applyFillReport(
      db,
      taskId,
      [field({ fieldId: "why-us", outcome: "filled", value: "Because." })],
      true,
    );
    expect(after.fieldReports).toHaveLength(1);
    expect(after.fieldReports.every((r) => r.outcome === "filled")).toBe(true);
    expect(after.applicationInfo?.status).toBe(1);
  });

  it("still merges an incremental report, so a wizard accumulates across pages", () => {
    const taskId = parkedTask();
    applyFillReport(db, taskId, [field({ fieldId: "name", page: "site/apply#step1" })], false);
    const after = applyFillReport(
      db,
      taskId,
      [field({ fieldId: "email", page: "site/apply#step2" })],
      false,
    );
    expect(after.fieldReports).toHaveLength(2);
  });

  it("does not duplicate a field when the page changes shape between fills", () => {
    // The regression itself: same page, same field, two scans. With a stable
    // page id the second replaces the first instead of joining it.
    const taskId = parkedTask();
    applyFillReport(db, taskId, [field({ fieldId: "why-us", outcome: "needs-user" })], false);
    const after = applyFillReport(
      db,
      taskId,
      [
        field({ fieldId: "why-us", outcome: "filled", value: "Because." }),
        field({ fieldId: "conditional-extra", outcome: "filled", value: "Yes" }),
      ],
      false,
    );
    expect(after.fieldReports.filter((r) => r.fieldId === "why-us")).toHaveLength(1);
    expect(after.fieldReports).toHaveLength(2);
  });
});

describe("replaying Done after the panel reopens", () => {
  const field = (over: Partial<FieldReport>): FieldReport => ({
    fieldId: "email",
    label: "Email",
    classifiedType: "email",
    status: "filled",
    source: "personal",
    reason: "",
    outcome: "filled",
    required: true,
    page: "boards.example.com/acme/apply",
    ...over,
  });

  function completedTask() {
    const application = createApplication(db, {
      jobInfo: { jobId: "j1", jobTitle: "Engineer", companyName: "Acme" },
    });
    const task = createPipelineTask(db, {
      applicationId: application.id,
      status: "awaiting_user",
      step: PIPELINE_STEPS.findIndex((s) => s.key === "fill-form"),
    });
    // A complete run with nothing outstanding parks the task at submit.
    applyFillReport(db, task.id, [field({})], true);
    return task.id;
  }

  it("accepts the same complete report again instead of rejecting it", () => {
    const taskId = completedTask();
    expect(PIPELINE_STEPS[getPipelineTask(db, taskId)!.step]?.key).toBe("submit");

    // The panel reopened, rehydrated from the bundle, and Done was pressed
    // again. This used to throw, and the panel swallowed the failure.
    const replayed = applyFillReport(db, taskId, [field({})], true);

    expect(PIPELINE_STEPS[replayed.step]?.key).toBe("submit");
    expect(replayed.fieldReports).toHaveLength(1);
    expect(replayed.applicationInfo?.status).toBe(1);
  });

  it("lands the same state twice — replay is idempotent, not additive", () => {
    const taskId = completedTask();
    const once = getPipelineTask(db, taskId)!;
    const twice = applyFillReport(db, taskId, [field({})], true);
    expect(twice.fieldReports).toEqual(once.fieldReports);
    expect(twice.applicationInfo).toEqual(once.applicationInfo);
  });

  it("accepts an INCREMENTAL report at the submit gate — the user is still working", () => {
    // Between finishing a fill and pressing submit on the employer's page, the
    // user refines an answer, accepts a better one, fixes a field by hand. The
    // panel reports each as it happens. Refusing those because the task had
    // moved to the submit gate meant the record stopped matching the page at
    // exactly the moment it mattered most.
    const taskId = completedTask();
    expect(PIPELINE_STEPS[getPipelineTask(db, taskId)!.step]?.key).toBe("submit");

    const after = applyFillReport(db, taskId, [field({ fieldId: "late" })], false);

    expect(after.fieldReports?.some((r) => r.fieldId === "late")).toBe(true);
    // It stays at the submit gate: an incremental report is an update, not a
    // statement that the run restarted.
    expect(PIPELINE_STEPS[after.step]?.key).toBe("submit");
  });

  it("refuses any report once the user has said they submitted", () => {
    // The line that still matters: a late report from a stale panel must not
    // reopen a record the user has closed.
    const taskId = completedTask();
    const { applicationId } = { applicationId: getPipelineTask(db, taskId)!.applicationId };
    markSubmitted(db, applicationId, "panel");
    expect(() => applyFillReport(db, taskId, [field({ fieldId: "late" })], false)).toThrow(
      /not awaiting fill/,
    );
    expect(() => applyFillReport(db, taskId, [field({ fieldId: "late" })], true)).toThrow(
      /not awaiting fill/,
    );
  });

  it("tells a re-claiming panel the run is already reported", () => {
    const taskId = completedTask();
    const task = getPipelineTask(db, taskId)!;
    // The ticket has to be opened while the task is still at the fill gate —
    // that guard is unchanged — then claimed once it has moved on, which is
    // exactly the re-open case.
    updatePipelineTask(db, taskId, {
      step: PIPELINE_STEPS.findIndex((s) => s.key === "fill-form"),
    });
    const handoff = createHandoffForTask(db, taskId);
    updatePipelineTask(db, taskId, {
      step: PIPELINE_STEPS.findIndex((s) => s.key === "submit"),
    });
    const bundle = claimHandoff(db, handoff.id);
    expect(bundle.taskParkedAtSubmit).toBe(true);
    void task;
  });
});

/**
 * Submitting an application is one act, so it is one function.
 *
 * There were four ways to say "I sent this" and they wrote three different
 * states — the worst of them, the web status dropdown, wrote `applied` and
 * nothing else: no date, no timeline entry, ticket still open, task still
 * parked, and no way back because undo restores from an event that path never
 * wrote. These tests hold that every door now produces the same five effects
 * and that every door can be walked back through.
 */
describe("every way of saying 'I submitted this'", () => {
  const effectsOf = (applicationId: string, taskId: string | null) => {
    const app = getApplication(db, applicationId)!;
    const task = taskId ? getPipelineTask(db, taskId) : null;
    const events = listEvents(db, applicationId);
    const marked = [...events].reverse().find((e) => e.kind === "marked-submitted");
    return {
      status: app.status,
      hasAppliedAt: typeof app.appliedAt === "number" && app.appliedAt > 0,
      taskStatus: task?.status ?? null,
      openHandoffs: listOpenFillHandoffs(db).filter((h) => h.applicationId === applicationId)
        .length,
      hasEvent: marked !== undefined,
      source: (marked?.payload as { source?: string } | undefined)?.source,
      undoable: marked !== undefined,
    };
  };

  it("the panel's I've-submitted button", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    createHandoffForTask(db, taskId);
    resolveFill(db, taskId, "applied-manually", "panel");

    const e = effectsOf(applicationId, taskId);
    expect(e.status).toBe("applied");
    expect(e.hasAppliedAt).toBe(true);
    expect(e.taskStatus).toBe("done");
    expect(e.openHandoffs).toBe(0);
    expect(e.hasEvent).toBe(true);
    expect(e.source).toBe("panel");
  });

  it("the web card's I've-applied button", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    createHandoffForTask(db, taskId);
    resolveFill(db, taskId, "applied-manually", "web-card");

    const e = effectsOf(applicationId, taskId);
    expect(e.status).toBe("applied");
    expect(e.hasAppliedAt).toBe(true);
    expect(e.taskStatus).toBe("done");
    expect(e.openHandoffs).toBe(0);
    expect(e.source).toBe("web-card");
  });

  it("the web status dropdown — the one that used to write nothing but a status", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    createHandoffForTask(db, taskId);
    markSubmitted(db, applicationId, "web-status");

    const e = effectsOf(applicationId, taskId);
    // Every one of these was wrong before: no date, task untouched, ticket
    // still open, nothing on the timeline, and therefore no undo.
    expect(e.status).toBe("applied");
    expect(e.hasAppliedAt).toBe(true);
    expect(e.taskStatus).toBe("done");
    expect(e.openHandoffs).toBe(0);
    expect(e.hasEvent).toBe(true);
    expect(e.source).toBe("web-status");
  });

  it("the agent's mark_submitted — which used to leave the ticket open", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    createHandoffForTask(db, taskId);
    updatePipelineTask(db, taskId, { step: SUBMIT_STEP, status: "awaiting_user" });
    completeSubmitted(db, taskId);

    const e = effectsOf(applicationId, taskId);
    expect(e.status).toBe("applied");
    expect(e.taskStatus).toBe("done");
    // The defect: the ticket stayed open and the application kept showing up
    // in the extension's "open to fill" list after it had been sent.
    expect(e.openHandoffs).toBe(0);
    expect(e.source).toBe("agent");
  });

  it("an application with no task at all is still a submission", () => {
    // Added by link, filled by hand, never opened in the panel.
    const app = createApplication(db, {
      jobInfo: { jobId: "j9", jobTitle: "Analyst", companyName: "Initech" },
    });
    const task = markSubmitted(db, app.id, "web-status");
    expect(task).toBeNull();
    const e = effectsOf(app.id, null);
    expect(e.status).toBe("applied");
    expect(e.hasAppliedAt).toBe(true);
    expect(e.hasEvent).toBe(true);
  });

  it("closes a ticket opened by an EARLIER task, not just the current one", () => {
    // Submission is an application-level fact; a ticket left behind by an
    // earlier run would keep the application in "open to fill" forever.
    const { taskId, applicationId } = seedTaskAtFillForm();
    const stale = createHandoffForTask(db, taskId);
    markSubmitted(db, applicationId, "web-status");
    expect(getFillHandoff(db, stale.id)!.status).toBe("completed");
  });

  it("pressing it twice does not destroy the undo record", () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    markSubmitted(db, applicationId, "web-status");
    markSubmitted(db, applicationId, "web-status");
    // A second press must not record prevApplicationStatus: "applied", which
    // would make undo restore the application to "applied".
    const marks = listEvents(db, applicationId).filter((e) => e.kind === "marked-submitted");
    expect(marks).toHaveLength(1);
    undoSubmitted(db, taskId);
    expect(getApplication(db, applicationId)!.status).not.toBe("applied");
  });
});

describe("taking a submission back, whichever door it came through", () => {
  it.each(["panel", "web-card", "web-status", "agent"] as const)("%s is undoable", (source) => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    createHandoffForTask(db, taskId);
    if (source === "agent") {
      updatePipelineTask(db, taskId, { step: SUBMIT_STEP, status: "awaiting_user" });
      completeSubmitted(db, taskId);
    } else if (source === "web-status") {
      markSubmitted(db, applicationId, "web-status");
    } else {
      resolveFill(db, taskId, "applied-manually", source);
    }
    expect(getApplication(db, applicationId)!.status).toBe("applied");

    undoSubmitted(db, taskId);

    const app = getApplication(db, applicationId)!;
    expect(app.status).not.toBe("applied");
    expect(app.appliedAt ?? null).toBeNull();
    expect(getPipelineTask(db, taskId)!.status).toBe("awaiting_user");
    expect(listEvents(db, applicationId).some((e) => e.kind === "submission-undone")).toBe(true);
  });

  it("undoes an application that never had a task", () => {
    const app = createApplication(db, {
      jobInfo: { jobId: "j9", jobTitle: "Analyst", companyName: "Initech" },
    });
    markSubmitted(db, app.id, "web-status");
    undoSubmittedForApplication(db, app.id);
    expect(getApplication(db, app.id)!.status).not.toBe("applied");
  });

  it("refuses to undo an application that was never marked here", () => {
    const app = createApplication(db, {
      jobInfo: { jobId: "j9", jobTitle: "Analyst", companyName: "Initech" },
    });
    expect(() => undoSubmittedForApplication(db, app.id)).toThrow(ServiceError);
  });
});

/**
 * Re-filling from the submit gate.
 *
 * A completely successful fill parks the task at submit. From there every route
 * back used to be a 400 the page rendered as "Something went wrong": the task
 * counted as already in position, while opening a ticket demanded the fill
 * gate. There was no way out of a finished fill except to mark it submitted.
 */
describe("filling again after a fill that finished", () => {
  const report = (over: Partial<FieldReport>): FieldReport => ({
    fieldId: "email",
    label: "Email",
    classifiedType: "email",
    status: "filled",
    source: "personal",
    reason: "",
    outcome: "filled",
    required: true,
    page: "boards.example.com/acme/apply",
    ...over,
  });

  const parkedAtSubmit = () => {
    const { taskId } = seedTaskAtFillForm();
    updatePipelineTask(db, taskId, { step: SUBMIT_STEP, status: "awaiting_user" });
    return taskId;
  };

  it("opening a ticket from the submit gate resets the task to the fill gate", () => {
    const taskId = parkedAtSubmit();
    const handoff = createHandoffForTask(db, taskId);
    expect(handoff.status).toBe("pending");
    expect(PIPELINE_STEPS[getPipelineTask(db, taskId)!.step]?.key).toBe("fill-form");
  });

  it("the reopened task accepts a report again", () => {
    // The whole point: after the reset the ordinary fill path works, rather
    // than the user meeting a second 400.
    const taskId = parkedAtSubmit();
    createHandoffForTask(db, taskId);
    const after = applyFillReport(db, taskId, [report({ fieldId: "f1" })], false);
    expect(after.fieldReports).toHaveLength(1);
  });

  it("still refuses a ticket for a task that is not waiting on the user at all", () => {
    const { taskId } = seedTaskAtFillForm();
    updatePipelineTask(db, taskId, { status: "running" });
    expect(() => createHandoffForTask(db, taskId)).toThrow(/not awaiting fill/);
  });

  it("still refuses a ticket for a finished task", () => {
    const taskId = parkedAtSubmit();
    completeSubmitted(db, taskId);
    expect(() => createHandoffForTask(db, taskId)).toThrow(/not awaiting fill/);
  });
});

/**
 * Ticket hygiene.
 *
 * A ticket was closed by exactly three things: a newer ticket for the same
 * task, a completed report, or the user resolving the fill. A panel that sent
 * one incremental report and then crashed left one open forever — and an open
 * ticket keeps its application in the extension's pending list and in the inbox
 * as "open the page to fill it", permanently, for a fill that ended weeks ago.
 */
describe("tickets that nobody ever closed", () => {
  const EIGHT_DAYS = 8 * 24 * 60 * 60 * 1000;

  const age = (handoffId: string, ms: number) => {
    db.run(
      sql`update fill_handoffs set created_at = ${Date.now() - ms}, updated_at = ${Date.now() - ms} where id = ${handoffId}`,
    );
  };

  it("stops reporting a week-old open ticket as live", () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    age(handoff.id, EIGHT_DAYS);

    expect(listOpenFillHandoffs(db).some((h) => h.id === handoff.id)).toBe(false);
    // And the expiry is written down, not merely filtered out of one read.
    expect(getFillHandoff(db, handoff.id)!.status).toBe("cancelled");
  });

  it("leaves a ticket from yesterday alone", () => {
    // An application opened Friday and finished Monday is an ordinary way to
    // apply for a job, not an abandoned one.
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    age(handoff.id, 24 * 60 * 60 * 1000);
    expect(listOpenFillHandoffs(db).some((h) => h.id === handoff.id)).toBe(true);
  });

  it("an expired ticket can no longer be claimed", () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    age(handoff.id, EIGHT_DAYS);
    expect(() => claimHandoff(db, handoff.id)).toThrow(/not open/);
  });

  it("expiring is idempotent — a cancelled ticket is not re-stamped", () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    age(handoff.id, EIGHT_DAYS);
    listOpenFillHandoffs(db);
    const first = getFillHandoff(db, handoff.id)!.updatedAt;
    listOpenFillHandoffs(db);
    expect(getFillHandoff(db, handoff.id)!.updatedAt).toBe(first);
  });
});

describe("two panels on one fill", () => {
  it("a claim is still allowed twice — a reloaded panel must be able to resume", () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    expect(claimHandoff(db, handoff.id).handoffId).toBe(handoff.id);
    expect(claimHandoff(db, handoff.id).handoffId).toBe(handoff.id);
  });

  it("the bundle says when the claim was made", () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    const bundle = claimHandoff(db, handoff.id);
    expect(typeof bundle.claimedAt).toBe("number");
    expect(bundle.claimedAt).toBeGreaterThan(0);
  });

  it("a panel holding the newest ticket is the current claimer", () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    expect(isCurrentClaim(db, taskId, handoff.id)).toBe(true);
  });

  it("a panel holding a superseded ticket is told so", () => {
    // Opening the fill again from the workspace cancels the old ticket and
    // makes a new one; the panel still holding the old one is no longer driving.
    const { taskId } = seedTaskAtFillForm();
    const first = createHandoffForTask(db, taskId);
    const second = createHandoffForTask(db, taskId);
    expect(isCurrentClaim(db, taskId, first.id)).toBe(false);
    expect(isCurrentClaim(db, taskId, second.id)).toBe(true);
  });

  it("says nothing when there is no open ticket to conflict with", () => {
    // A report arriving after the run closed is not a conflict, it is late.
    const { taskId } = seedTaskAtFillForm();
    const handoff = createHandoffForTask(db, taskId);
    applyFillReport(db, taskId, [], true);
    expect(isCurrentClaim(db, taskId, handoff.id)).toBe(true);
  });
});
