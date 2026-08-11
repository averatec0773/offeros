import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPELINE_STEPS } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import { createApplication, updateApplication } from "../../repositories/application-repo";
import { createPipelineTask, updatePipelineTask } from "../../repositories/pipeline-task-repo";
import { buildInbox } from "../attention-service";

const FILL_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "fill-form");
const SUBMIT_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "submit");
const CONFIRM_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "confirm-resume");

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-attention-"));
  db = createDb(join(dir, "t.db"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seed(title: string): string {
  return createApplication(db, {
    jobInfo: { jobId: `j-${title}`, jobTitle: title, companyName: "Acme" },
  }).id;
}

describe("buildInbox", () => {
  it("lists an application with no task as not-started", () => {
    seed("AI Engineer");
    expect(buildInbox(db).map((i) => i.kind)).toEqual(["not-started"]);
  });

  it("surfaces Action-Required fields with their names", () => {
    const id = seed("AI Engineer");
    const task = createPipelineTask(db, { applicationId: id });
    updatePipelineTask(db, task.id, {
      step: FILL_STEP,
      status: "awaiting_user",
      applicationInfo: {
        status: 2,
        filledFields: ["Email"],
        missingFields: ["LinkedIn", "Portfolio"],
      },
    });
    const [item] = buildInbox(db);
    expect(item).toMatchObject({ kind: "missing-fields", headline: "2 fields need you" });
    expect(item!.detail).toBe("LinkedIn, Portfolio");
  });

  it("does NOT claim the user's turn while the fill gate waits on the browser", () => {
    // status 1 = everything filled: the extension is mid-run or done, and the
    // person has nothing to do. Listing it would train them to ignore the inbox.
    const id = seed("AI Engineer");
    const task = createPipelineTask(db, { applicationId: id });
    updatePipelineTask(db, task.id, {
      step: FILL_STEP,
      status: "awaiting_user",
      applicationInfo: { status: 1, filledFields: ["Email"], missingFields: [] },
    });
    expect(buildInbox(db)).toEqual([]);
  });

  it("ignores confirm gates — review steps are the workspace's job", () => {
    const id = seed("AI Engineer");
    const task = createPipelineTask(db, { applicationId: id });
    updatePipelineTask(db, task.id, { step: CONFIRM_STEP, status: "awaiting_user" });
    expect(buildInbox(db)).toEqual([]);
  });

  it("orders by what the user loses: missing fields, then submit, then failures", () => {
    const notStarted = seed("Not started");
    const submit = seed("Ready");
    const failed = seed("Broken");
    const missing = seed("Needs answers");
    void notStarted;

    const t1 = createPipelineTask(db, { applicationId: submit });
    updatePipelineTask(db, t1.id, { step: SUBMIT_STEP, status: "awaiting_user" });
    const t2 = createPipelineTask(db, { applicationId: failed });
    updatePipelineTask(db, t2.id, { status: "failed", failureReason: "provider down" });
    const t3 = createPipelineTask(db, { applicationId: missing });
    updatePipelineTask(db, t3.id, {
      step: FILL_STEP,
      status: "awaiting_user",
      applicationInfo: { status: 2, filledFields: [], missingFields: ["Gender"] },
    });

    expect(buildInbox(db).map((i) => i.kind)).toEqual([
      "missing-fields",
      "ready-to-submit",
      "failed",
      "not-started",
    ]);
    expect(buildInbox(db).find((i) => i.kind === "failed")?.detail).toBe("provider down");
  });

  it("drops applications that are already applied or archived", () => {
    const id = seed("Done");
    updateApplication(db, id, { status: "applied" });
    expect(buildInbox(db)).toEqual([]);
  });
});
