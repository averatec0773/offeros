import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPELINE_STEPS, type FieldReport } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import { createApplication } from "../../repositories/application-repo";
import { createPipelineTask, updatePipelineTask } from "../../repositories/pipeline-task-repo";
import { formShapes } from "../../db/schema";
import { knownShapes, listIncidents } from "../../repositories/form-memory-repo";
import { recordFillOutcome } from "../form-memory";
import { applyFillReport } from "../fill-service";

const FILL_FORM_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "fill-form");

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-form-memory-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A field report, defaulting to a question that filled cleanly. */
function report(over: Partial<FieldReport> & { questionKey?: string }): FieldReport {
  return {
    fieldId: "f1",
    label: "Question",
    classifiedType: "unknown",
    status: "fillable",
    source: "personal",
    reason: "matched profile.personal.email",
    outcome: "filled",
    required: true,
    questionKey: "k1",
    ...over,
  };
}

/** A report the engine did not understand — the shape every trigger keys on. */
const unrecognised = (over: Partial<FieldReport>): FieldReport =>
  report({
    source: "none",
    reason: "no classifier match → left unknown",
    outcome: "skipped",
    ...over,
  });

function seedApp(applyLink = "https://boards.greenhouse.io/acme/jobs/1"): {
  applicationId: string;
  taskId: string;
} {
  const app = createApplication(db, {
    jobInfo: { jobId: "j", jobTitle: "Engineer", companyName: "Acme", applyLink },
  });
  const task = createPipelineTask(db, { applicationId: app.id });
  updatePipelineTask(db, task.id, { step: FILL_FORM_STEP, status: "awaiting_user" });
  return { applicationId: app.id, taskId: task.id };
}

describe("recordFillOutcome — shapes", () => {
  it("records one row per distinct question, with the platform it came from", () => {
    const { applicationId, taskId } = seedApp();
    recordFillOutcome(db, {
      applicationId,
      taskId,
      applyLink: "https://boards.greenhouse.io/acme/jobs/1",
      reports: [
        report({ fieldId: "a", questionKey: "k1", label: "Email" }),
        report({ fieldId: "b", questionKey: "k2", label: "Phone" }),
      ],
    });
    const rows = db.select().from(formShapes).all();
    expect(rows.map((r) => r.questionKey).sort()).toEqual(["k1", "k2"]);
    expect(rows.every((r) => r.vendor === "Greenhouse")).toBe(true);
    expect(rows.every((r) => r.seenCount === 1)).toBe(true);
  });

  it("counts a question once per fill even when the form asks it twice", () => {
    const { applicationId, taskId } = seedApp();
    recordFillOutcome(db, {
      applicationId,
      taskId,
      reports: [
        report({ fieldId: "a", questionKey: "same" }),
        report({ fieldId: "b", questionKey: "same" }),
      ],
    });
    expect(db.select().from(formShapes).all()[0]?.seenCount).toBe(1);
  });

  it("increments across fills instead of replacing the row", () => {
    const first = seedApp();
    const second = seedApp("https://jobs.lever.co/acme/2");
    recordFillOutcome(db, { ...first, reports: [report({ questionKey: "k1" })] });
    recordFillOutcome(db, { ...second, reports: [report({ questionKey: "k1" })] });
    const row = db.select().from(formShapes).all()[0]!;
    expect(row.seenCount).toBe(2);
    // First vendor wins: the row is not re-homed by a later sighting.
    expect(row.vendor).toBe("Other");
  });

  it("only counts failures the engine could have prevented", () => {
    const { applicationId, taskId } = seedApp();
    recordFillOutcome(db, {
      applicationId,
      taskId,
      reports: [
        unrecognised({ fieldId: "a", questionKey: "miss" }),
        // A guard refusing a demographic question is the system working.
        report({
          fieldId: "b",
          questionKey: "guarded",
          outcome: "needs-user",
          source: "none",
          reason: "sensitive guard: only you can answer this",
        }),
      ],
    });
    const byKey = new Map(
      db
        .select()
        .from(formShapes)
        .all()
        .map((r) => [r.questionKey, r]),
    );
    expect(byKey.get("miss")?.failedCount).toBe(1);
    expect(byKey.get("guarded")?.failedCount).toBe(0);
  });

  it("remembers the first application a question failed on, not the latest", () => {
    const first = seedApp();
    const second = seedApp();
    recordFillOutcome(db, { ...first, reports: [unrecognised({ questionKey: "k" })] });
    recordFillOutcome(db, { ...second, reports: [unrecognised({ questionKey: "k" })] });
    const row = db.select().from(formShapes).all()[0]!;
    expect(row.firstFailedApplicationId).toBe(first.applicationId);
    expect(row.failedCount).toBe(2);
  });

  it("ignores reports with no question key rather than inventing one", () => {
    const { applicationId, taskId } = seedApp();
    recordFillOutcome(db, {
      applicationId,
      taskId,
      reports: [{ ...report({}), questionKey: undefined }],
    });
    expect(db.select().from(formShapes).all()).toHaveLength(0);
  });
});

describe("knownShapes", () => {
  it("reports a failure on another application, but not on this one", () => {
    const first = seedApp();
    const second = seedApp();
    recordFillOutcome(db, { ...first, reports: [unrecognised({ questionKey: "k" })] });

    expect(knownShapes(db, ["k"], second.applicationId).failedElsewhere.has("k")).toBe(true);
    expect(knownShapes(db, ["k"], first.applicationId).failedElsewhere.has("k")).toBe(false);
    expect(knownShapes(db, ["k"], first.applicationId).seen.has("k")).toBe(true);
  });
});

describe("recordFillOutcome — incidents", () => {
  it("raises nothing for a form that filled cleanly", () => {
    const { applicationId, taskId } = seedApp();
    const incidents = recordFillOutcome(db, {
      applicationId,
      taskId,
      reports: [report({ questionKey: "k1" }), report({ fieldId: "b", questionKey: "k2" })],
    });
    expect(incidents).toEqual([]);
    expect(listIncidents(db)).toHaveLength(0);
  });

  it("raises an incident for a never-seen required question it cannot classify", () => {
    const { applicationId, taskId } = seedApp();
    const incidents = recordFillOutcome(db, {
      applicationId,
      taskId,
      reports: [unrecognised({ questionKey: "novel", required: true })],
    });
    expect(incidents.map((i) => i.triggerId)).toContain("unrecognised-required");
    expect(listIncidents(db, applicationId)[0]?.questionKeys).toEqual(["novel"]);
  });

  it("does not raise the same novelty twice — the second fill has seen it", () => {
    const first = seedApp();
    const second = seedApp();
    const reports = [unrecognised({ questionKey: "novel", required: true })];
    expect(recordFillOutcome(db, { ...first, reports })).toHaveLength(1);
    // Now it is both seen AND failed elsewhere: it re-fires as a repeat, which
    // is a different problem with a different fix, but never again as novelty.
    const again = recordFillOutcome(db, { ...second, reports });
    expect(again.map((i) => i.triggerId)).toEqual(["repeat-offender"]);
  });

  it("reads the shape table as it was BEFORE this fill", () => {
    const { applicationId, taskId } = seedApp();
    // If the sightings were written first, this question would already be
    // "seen" by the time the triggers ran and nothing would ever fire.
    const incidents = recordFillOutcome(db, {
      applicationId,
      taskId,
      reports: [unrecognised({ questionKey: "novel", required: true })],
    });
    expect(incidents).toHaveLength(1);
  });
});

describe("applyFillReport wiring", () => {
  it("records form memory when the fill run completes", () => {
    const { applicationId, taskId } = seedApp();
    applyFillReport(db, taskId, [unrecognised({ questionKey: "novel", required: true })], true);
    expect(db.select().from(formShapes).all()).toHaveLength(1);
    expect(listIncidents(db, applicationId)).toHaveLength(1);
  });

  it("records nothing for a partial batch — the form is not finished yet", () => {
    const { taskId } = seedApp();
    applyFillReport(db, taskId, [report({ questionKey: "k1" })], false);
    expect(db.select().from(formShapes).all()).toHaveLength(0);
  });

  it("never lets a bookkeeping failure break the fill", () => {
    const { taskId } = seedApp();
    // Drop the table out from under it: the fill must still be persisted.
    db.run("DROP TABLE form_shapes");
    const task = applyFillReport(db, taskId, [report({ questionKey: "k1" })], true);
    expect(task.fieldReports).toHaveLength(1);
  });
});

describe("applyFillReport idempotency", () => {
  it("does not double-count when a partial fill's Done is posted twice", () => {
    const { applicationId, taskId } = seedApp();
    // A required field failed → the task stays at fill-form (Action Required),
    // so a second complete report passes the state guard. The memory layer
    // must not count the same fill twice — seen_count feeds the recurrence
    // number the whole learning decision reads.
    const reports = [unrecognised({ questionKey: "novel", required: true })];
    applyFillReport(db, taskId, reports, true);
    applyFillReport(db, taskId, reports, true);

    expect(db.select().from(formShapes).all()[0]?.seenCount).toBe(1);
    expect(listIncidents(db, applicationId)).toHaveLength(1);
  });
});
