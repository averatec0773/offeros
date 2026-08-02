import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { createApplication } from "../application-repo";
import { appendEvent, listEvents } from "../application-event-repo";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-application-event-repo-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function makeApplication(db: Db) {
  return createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver" },
  });
}

describe("application-event repo", () => {
  it("appends an event and lists it back with a generated id and timestamp", () => {
    const app = makeApplication(db);
    appendEvent(db, { applicationId: app.id, kind: "task-started" });

    const events = listEvents(db, app.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.applicationId).toBe(app.id);
    expect(events[0]?.kind).toBe("task-started");
    expect(events[0]?.id).toBeTruthy();
    expect(typeof events[0]?.at).toBe("number");
    expect(events[0]?.payload).toBeUndefined();
  });

  it("carries an optional payload through", () => {
    const app = makeApplication(db);
    appendEvent(db, {
      applicationId: app.id,
      kind: "step-completed",
      payload: { step: "analyze-site" },
    });

    const events = listEvents(db, app.id);
    expect(events[0]?.payload).toEqual({ step: "analyze-site" });
  });

  it("lists events in ascending chronological order", () => {
    const app = makeApplication(db);
    appendEvent(db, { applicationId: app.id, kind: "task-started" });
    appendEvent(db, {
      applicationId: app.id,
      kind: "step-completed",
      payload: { step: "tailor-resume" },
    });
    appendEvent(db, {
      applicationId: app.id,
      kind: "artifact-approved",
      payload: { kind: "resume" },
    });

    const events = listEvents(db, app.id);
    expect(events.map((e) => e.kind)).toEqual([
      "task-started",
      "step-completed",
      "artifact-approved",
    ]);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.at).toBeGreaterThanOrEqual(events[i - 1]!.at);
    }
  });

  it("only returns events for the requested application", () => {
    const app1 = makeApplication(db);
    const app2 = makeApplication(db);
    appendEvent(db, { applicationId: app1.id, kind: "task-started" });
    appendEvent(db, { applicationId: app2.id, kind: "task-started" });

    expect(listEvents(db, app1.id)).toHaveLength(1);
    expect(listEvents(db, app2.id)).toHaveLength(1);
  });

  it("returns an empty list for an application with no events", () => {
    const app = makeApplication(db);
    expect(listEvents(db, app.id)).toEqual([]);
  });

  it("never throws when the insert fails, and logs instead — bookkeeping never breaks the caller", () => {
    const app = makeApplication(db);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const originalInsert = db.insert.bind(db);
    // Simulate an insert failure (e.g. a closed/unusable db handle).
    (db as unknown as { insert: unknown }).insert = () => {
      throw new Error("simulated insert failure");
    };

    expect(() => appendEvent(db, { applicationId: app.id, kind: "task-started" })).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();

    (db as unknown as { insert: unknown }).insert = originalInsert;
    expect(listEvents(db, app.id)).toEqual([]);
    errorSpy.mockRestore();
  });
});
