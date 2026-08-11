import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FieldReport } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import { createApplication } from "../../repositories/application-repo";
import { createPipelineTask, updatePipelineTask } from "../../repositories/pipeline-task-repo";
import { readFillReportTool } from "../read-tools";
import type { ToolContext } from "../types";

/**
 * read_fill_report's headline must report against FILLABLE fields, not the raw
 * scanned total. A 2026-08-10 audit (reproduced live) found the denominator
 * included deliberately-skipped fields, so a good fill read as a near-failure.
 */

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

let db: Db;
let dir: string;
let appId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-readtools-"));
  db = createDb(join(dir, "t.db"));
  appId = createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "AI Engineer", companyName: "Acme" },
  }).id;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("read_fill_report headline denominator", () => {
  it("excludes deliberately-skipped fields from the ratio, and reports them separately", async () => {
    const task = createPipelineTask(db, { applicationId: appId });
    // 3 filled, 4 skipped (standard/pre-filled), 2 needs-user problems.
    const reports: FieldReport[] = [
      field({ outcome: "filled", label: "First name" }),
      field({ outcome: "filled", label: "Email" }),
      field({ outcome: "filled", label: "Phone" }),
      ...Array.from({ length: 4 }, () => field({ outcome: "skipped" })),
      field({ outcome: "needs-user", required: true, reason: "no saved answer" }),
      field({ outcome: "needs-user", required: true, reason: "no saved answer" }),
    ];
    updatePipelineTask(db, task.id, { fieldReports: reports });

    const ctx: ToolContext = { db, applicationId: appId, taskId: task.id };
    const obs = await readFillReportTool.run(ctx, undefined);

    // Honest: 3 of (9 - 4 skipped) = 3 of 5 fillable, NOT 3 of 9.
    expect(obs.summary).toContain("3 of 5 fillable fields filled");
    expect(obs.summary).toContain("4 standard fields skipped");
    expect(obs.summary).not.toContain("3 of 9");
    // The full breakdown is preserved in the result for any caller that wants it.
    const result = obs.result as { total: number; skipped: number; fillable: number };
    expect(result.total).toBe(9);
    expect(result.skipped).toBe(4);
    expect(result.fillable).toBe(5);
  });
});
