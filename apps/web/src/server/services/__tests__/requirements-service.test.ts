import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FieldReport, Profile } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import { createApplication } from "../../repositories/application-repo";
import { createPipelineTask, updatePipelineTask } from "../../repositories/pipeline-task-repo";
import { appendEvent } from "../../repositories/application-event-repo";
import { recordShapes } from "../../repositories/form-memory-repo";
import { createAnswer } from "../../repositories/answer-repo";
import { saveProfile } from "../../repositories/profile-repo";
import { buildRequirements } from "../requirements-service";

/**
 * The requirements card must never flatter the user. Everything it claims is
 * a lookup the fill engine would make; a question we cannot answer counts as
 * missing, and no data at all counts as "not looked", never as ready.
 */

let db: Db;
let dir: string;
let appId: string;

const PROFILE: Profile = {
  personal: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "555-0100",
    links: {},
  },
  skills: [],
  education: [],
  experience: [],
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-req-"));
  db = createDb(join(dir, "t.db"));
  appId = createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
  }).id;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const field = (over: Partial<FieldReport>): FieldReport => ({
  fieldId: Math.random().toString(36).slice(2),
  label: "Field",
  classifiedType: "unknown",
  status: "filled",
  source: "personal",
  reason: "",
  outcome: "filled",
  required: false,
  ...over,
});

/** Record a prescan the way recon-service does: shapes, plus the keys on the
 *  application's own timeline. */
function seedPrescan(
  questions: { key: string; question: string; control: string; required: boolean }[],
) {
  recordShapes(
    db,
    "greenhouse",
    appId,
    questions.map((q) => ({
      questionKey: q.key,
      question: q.question,
      classifiedType: q.control,
      failed: false,
      required: q.required,
    })),
    1_000,
    "prescan",
  );
  appendEvent(db, {
    applicationId: appId,
    kind: "job-checked",
    payload: {
      verdict: "open",
      detail: "The posting is still up.",
      questionKeys: questions.map((q) => q.key),
    },
  });
}

describe("no data", () => {
  it("says it has not looked rather than reporting an optimistic zero", () => {
    const summary = buildRequirements(db, appId)!;
    expect(summary.source).toBe("none");
    expect(summary.total).toBe(0);
    expect(summary.lastChecked).toBeUndefined();
  });

  it("returns null for an application that does not exist", () => {
    expect(buildRequirements(db, "nope")).toBeNull();
  });
});

describe("prescan", () => {
  it("counts required questions and names the ones with no answer", () => {
    saveProfile(db, PROFILE);
    seedPrescan([
      { key: "k1", question: "Email", control: "email", required: true },
      { key: "k2", question: "First Name", control: "text", required: true },
      {
        key: "k3",
        question: "Why do you want to work here?",
        control: "long-text",
        required: true,
      },
      {
        key: "k4",
        question: "Do you need visa sponsorship?",
        control: "single-select",
        required: true,
      },
      { key: "k5", question: "LinkedIn", control: "text", required: false },
    ]);

    const summary = buildRequirements(db, appId)!;
    expect(summary.source).toBe("prescan");
    expect(summary.total).toBe(5);
    expect(summary.required).toBe(4);
    // Email and first name come from the profile; the other two are genuinely
    // unanswered and must be named rather than counted away.
    expect(summary.ready).toBe(2);
    expect(summary.missing).toContain("Why do you want to work here?");
    expect(summary.missing).toContain("Do you need visa sponsorship?");
    expect(summary.freeText).toBe(1);
  });

  it("counts a saved answer as ready, using the fill engine's own matching", () => {
    saveProfile(db, PROFILE);
    createAnswer(db, {
      questionPatterns: ["sponsorship", "Do you need visa sponsorship?"],
      answer: "No",
      type: "text",
      category: "custom",
    });
    seedPrescan([
      {
        key: "k4",
        question: "Do you need visa sponsorship?",
        control: "single-select",
        required: true,
      },
    ]);

    const summary = buildRequirements(db, appId)!;
    expect(summary.ready).toBe(1);
    expect(summary.missing).toEqual([]);
  });

  it("flags a cover-letter field so the card can offer to write one", () => {
    seedPrescan([{ key: "c1", question: "Cover Letter", control: "long-text", required: false }]);
    expect(buildRequirements(db, appId)!.needsCoverLetter).toBe(true);
  });

  it("carries the last check's verdict for the freshness line", () => {
    seedPrescan([{ key: "k1", question: "Email", control: "email", required: true }]);
    const summary = buildRequirements(db, appId)!;
    expect(summary.lastChecked?.verdict).toBe("open");
    expect(summary.lastChecked?.detail).toBe("The posting is still up.");
  });
});

describe("a real fill outranks a prescan", () => {
  it("reports the form the engine actually met, not the one advertised", () => {
    saveProfile(db, PROFILE);
    seedPrescan([
      { key: "k1", question: "Email", control: "email", required: true },
      { key: "k2", question: "First Name", control: "text", required: true },
    ]);
    const task = createPipelineTask(db, { applicationId: appId });
    updatePipelineTask(db, task.id, {
      fieldReports: [
        field({ label: "Email", classifiedType: "email", required: true }),
        field({
          label: "Describe a hard problem you solved",
          classifiedType: "long-text",
          required: true,
          outcome: "needs-user",
        }),
        // Skipped fields are not questions the user has to deal with.
        field({ label: "Hidden token", outcome: "skipped", required: true }),
      ],
    });

    const summary = buildRequirements(db, appId)!;
    expect(summary.source).toBe("fill");
    expect(summary.total).toBe(2);
    expect(summary.required).toBe(2);
    expect(summary.missing).toEqual(["Describe a hard problem you solved"]);
    expect(summary.freeText).toBe(1);
  });
});
