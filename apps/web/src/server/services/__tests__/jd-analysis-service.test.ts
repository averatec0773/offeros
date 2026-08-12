import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { createApplication } from "../../repositories/application-repo";
import { getJdAnalysis } from "../../repositories/jd-analysis-repo";
import { listEvents } from "../../repositories/application-event-repo";
import { analyzeJd, JdAnalysisError } from "../jd-analysis-service";

/**
 * The reading is bought once and kept. These tests hold the two properties
 * that matter: it is stored where the page will find it, and re-reading
 * replaces the understanding rather than accumulating copies.
 */

let db: Db;
let dir: string;
let appId: string;

const OUTPUT = {
  summary: "A senior ML role.",
  responsibilities: ["Own the pipeline"],
  requiredSkills: ["Python", "Go"],
  preferredSkills: ["Kubernetes"],
  matchNotes: ["Strong Python overlap"],
  gaps: ["Go"],
  coverLetterRequirement: "optional" as const,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-jd-"));
  db = createDb(join(dir, "t.db"));
  appId = createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
    jdText: "We need Python and Go.",
  }).id;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("analyzeJd", () => {
  it("stores the reading where the application page reads it", async () => {
    const runLlm = vi.fn(async (_task: string, _input: unknown) => OUTPUT as unknown);
    const analysis = await analyzeJd(db, appId, { runLlm });

    expect(runLlm).toHaveBeenCalledTimes(1);
    expect(runLlm.mock.calls[0]![0]).toBe("jd-analysis");
    expect(analysis.requiredSkills).toEqual(["Python", "Go"]);
    expect(getJdAnalysis(db, appId)!.summary).toBe("A senior ML role.");
  });

  it("passes the posting text to the task, which fences it", async () => {
    const runLlm = vi.fn(async (_task: string, _input: unknown) => OUTPUT as unknown);
    await analyzeJd(db, appId, { runLlm });
    const input = runLlm.mock.calls[0]![1] as { jdText: string };
    expect(input.jdText).toBe("We need Python and Go.");
  });

  it("re-reading replaces the understanding in place, keeping one row", async () => {
    const runLlm = vi.fn(async () => OUTPUT);
    const first = await analyzeJd(db, appId, { runLlm });
    const second = await analyzeJd(db, appId, {
      runLlm: async () => ({ ...OUTPUT, summary: "A revised reading." }),
    });

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(getJdAnalysis(db, appId)!.summary).toBe("A revised reading.");
  });

  it("records the reading on the timeline", async () => {
    await analyzeJd(db, appId, { runLlm: async () => OUTPUT });
    expect(listEvents(db, appId).some((e) => e.kind === "jd-analyzed")).toBe(true);
  });

  it("refuses, without spending anything, when there is no description", async () => {
    const bare = createApplication(db, {
      jobInfo: { jobId: "j2", jobTitle: "Bare", companyName: "Co" },
    }).id;
    const runLlm = vi.fn(async (_task: string, _input: unknown) => OUTPUT as unknown);

    await expect(analyzeJd(db, bare, { runLlm })).rejects.toBeInstanceOf(JdAnalysisError);
    expect(runLlm).not.toHaveBeenCalled();
  });

  it("refuses for an application that does not exist", async () => {
    await expect(analyzeJd(db, "nope", { runLlm: async () => OUTPUT })).rejects.toBeInstanceOf(
      JdAnalysisError,
    );
  });
});
