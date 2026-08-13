import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { createApplication } from "../../repositories/application-repo";
import { createPipelineTask, updatePipelineTask } from "../../repositories/pipeline-task-repo";
import { createAnswer } from "../../repositories/answer-repo";
import { readAnswerGapsTool } from "../read-tools";

/**
 * The agent reads the same coverage model the profile page does, so it cannot
 * tell the user a different story about the same question.
 */

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-gaps-tool-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const report = (label: string) => ({
  fieldId: label,
  label,
  classifiedType: "unknown",
  status: "needs-answer",
  source: "none",
  reason: "",
  outcome: "needs-user" as const,
  required: true,
});

/** Two applications that both asked the same thing. */
function seedTwoApplications() {
  for (const company of ["Northwind", "Acme"]) {
    const app = createApplication(db, {
      jobInfo: { jobId: company, jobTitle: "Engineer", companyName: company },
    });
    const task = createPipelineTask(db, { applicationId: app.id });
    updatePipelineTask(db, task.id, {
      fieldReports: [
        report("What is your expected salary?"),
        report("Are you legally authorized to work in the U.S.?"),
      ],
    });
  }
}

const run = async (input?: { limit?: number }) =>
  readAnswerGapsTool.run!({ db } as never, readAnswerGapsTool.parse!(input ?? null) as never);

describe("read_answer_gaps", () => {
  it("counts the applications that asked, not just the sightings", async () => {
    seedTwoApplications();
    const res = await run();
    expect(res.ok).toBe(true);
    const gap = res.result!.gaps.find((g) => g.question.includes("expected salary"));
    expect(gap?.askedOnApplications).toBe(2);
  });

  it("keeps the questions it will not answer in their own list", async () => {
    seedTwoApplications();
    const res = await run();
    // Work authorisation is the user's own legal statement. The agent is told
    // about it separately so it never offers to answer one.
    expect(res.result!.weWillNotAnswer.join(" ")).toMatch(/authorized to work/i);
    expect(res.result!.gaps.map((g) => g.question).join(" ")).not.toMatch(/authorized to work/i);
  });

  it("stops listing a question once it has an answer", async () => {
    seedTwoApplications();
    createAnswer(db, {
      questionPatterns: ["What is your expected salary?", "expected salary"],
      answer: "$180,000",
      type: "text",
      category: "screening",
    });
    const res = await run();
    expect(res.result!.gaps.map((g) => g.question).join(" ")).not.toMatch(/expected salary/i);
  });

  it("reports the true total even when the list is capped", async () => {
    seedTwoApplications();
    const res = await run({ limit: 1 });
    expect(res.result!.shown).toBeLessThanOrEqual(1);
    expect(res.result!.total).toBeGreaterThanOrEqual(1);
  });

  it("says so plainly when there is nothing outstanding", async () => {
    const res = await run();
    expect(res.summary).toMatch(/every question/i);
  });
});
