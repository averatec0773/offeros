import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { createApplication } from "../application-repo";
import { createAgentTask } from "../agent-task-repo";
import {
  createFillHandoff,
  getFillHandoff,
  listOpenFillHandoffs,
  updateFillHandoff,
} from "../fill-handoff-repo";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-fill-handoff-repo-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function makeTask(db: Db) {
  const app = createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver" },
  });
  return createAgentTask(db, { applicationId: app.id });
}

describe("fill-handoff repo", () => {
  it("creates a pending handoff and round-trips via getFillHandoff", () => {
    const task = makeTask(db);
    const created = createFillHandoff(db, {
      taskId: task.id,
      applicationId: task.applicationId,
      applyLink: "https://example.com/apply",
    });
    expect(created.status).toBe("pending");
    expect(created.applyLink).toBe("https://example.com/apply");

    const fetched = getFillHandoff(db, created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.taskId).toBe(task.id);
  });

  it("returns null for a missing id", () => {
    expect(getFillHandoff(db, "nope")).toBeNull();
  });

  it("cancels any existing open (pending/claimed) handoff for the same task before creating a new one", () => {
    const task = makeTask(db);
    const first = createFillHandoff(db, { taskId: task.id, applicationId: task.applicationId });
    updateFillHandoff(db, first.id, { status: "claimed" });

    const second = createFillHandoff(db, { taskId: task.id, applicationId: task.applicationId });

    expect(getFillHandoff(db, first.id)?.status).toBe("cancelled");
    expect(second.status).toBe("pending");
    expect(second.id).not.toBe(first.id);
  });

  it("listOpenFillHandoffs returns only pending/claimed, newest first", () => {
    const task = makeTask(db);
    const other = makeTask(db);

    const h1 = createFillHandoff(db, { taskId: task.id, applicationId: task.applicationId });
    const h2 = createFillHandoff(db, { taskId: other.id, applicationId: other.applicationId });
    updateFillHandoff(db, h2.id, { status: "claimed" });
    const h3 = createFillHandoff(db, { taskId: task.id, applicationId: task.applicationId }); // supersedes h1

    const open = listOpenFillHandoffs(db);
    expect(open.map((h) => h.id)).toEqual([h3.id, h2.id]);
    expect(open.every((h) => h.status === "pending" || h.status === "claimed")).toBe(true);
    expect(open.find((h) => h.id === h1.id)).toBeUndefined();
  });

  it("updateFillHandoff patches status and returns null for a missing id", () => {
    const task = makeTask(db);
    const created = createFillHandoff(db, { taskId: task.id, applicationId: task.applicationId });

    const updated = updateFillHandoff(db, created.id, { status: "completed" });
    expect(updated?.status).toBe("completed");
    expect(getFillHandoff(db, created.id)?.status).toBe("completed");

    expect(updateFillHandoff(db, "nope", { status: "completed" })).toBeNull();
  });
});
