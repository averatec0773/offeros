import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { createApplication, getApplication } from "../../repositories/application-repo";
import { listEvents } from "../../repositories/application-event-repo";
import { reconInBackground } from "../recon-service";

/**
 * A job added from the browser panel gets the same check on arrival that one
 * added by pasting a link does.
 *
 * Before this, the two panel paths — "add this job" from a posting page, and
 * one-click instant fill — created an application with no description, no
 * verdict and no requirements until the user found the button. The check runs
 * behind the response rather than in front of it, because the instant lane's
 * whole promise is that filling starts immediately.
 */

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-recon-create-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const seed = (over: { applyLink?: string; jdText?: string } = {}) =>
  createApplication(db, {
    jobInfo: {
      jobId: "j1",
      jobTitle: "Engineer",
      companyName: "Acme",
      ...(over.applyLink === undefined ? { applyLink: "https://ats.example.com/apply/1" } : {}),
      ...(over.applyLink ? { applyLink: over.applyLink } : {}),
    },
    ...(over.jdText ? { jdText: over.jdText } : {}),
  }).id;

describe("checking a newly created application", () => {
  it("does nothing when there is no link to check", () => {
    // A record with no address is not a page anyone can read.
    const id = createApplication(db, {
      jobInfo: { jobId: "j1", jobTitle: "Engineer", companyName: "Acme" },
    }).id;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    reconInBackground(db, id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the description already arrived with the record", () => {
    // The add-by-link path fills jdText itself; re-fetching would spend a
    // request to learn what is already known.
    const id = seed({ jdText: "We are hiring an engineer." });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    reconInBackground(db, id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does nothing for an application that does not exist", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(() => reconInBackground(db, "nope")).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("checks a link-bearing record with no description yet, and records the verdict", async () => {
    // The host does not resolve, so the outbound guard refuses before any
    // request leaves — which is itself a verdict, and it lands on the timeline
    // exactly as a successful check would. That is the observable proof the
    // check ran at all.
    const id = seed();
    reconInBackground(db, id);
    await new Promise((r) => setTimeout(r, 50));
    const events = listEvents(db, id);
    expect(events.some((e) => e.kind === "job-checked")).toBe(true);
  });

  it("a failed check never becomes an error about creating the job", async () => {
    // The application is already saved and the page carries the same check on a
    // button; a reconnaissance that could not read the page must stay quiet.
    const id = seed();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("DNS failure");
      }),
    );
    expect(() => reconInBackground(db, id)).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    // The record is intact, and still the one that was created.
    expect(getApplication(db, id)!.jobInfo.jobTitle).toBe("Engineer");
  });
});
