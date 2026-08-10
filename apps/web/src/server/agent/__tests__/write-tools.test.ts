import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Profile } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import { createApplication, getApplication } from "../../repositories/application-repo";
import { saveProfile, getProfile } from "../../repositories/profile-repo";
import { listAnswers } from "../../repositories/answer-repo";
import { runTool } from "../run-tool";
import { listTrace } from "../../repositories/agent-trace-repo";
import {
  saveAnswerTool,
  deleteAnswerTool,
  updateApplicationTool,
  updateProfileTool,
} from "../write-tools";
import { appendChatMessage, listRecentMessages, listThread } from "../../repositories/chat-repo";

let db: Db;
let dir: string;
let applicationId: string;

const PROFILE: Profile = {
  personal: { name: "Jordan Rivera", email: "j@example.com", phone: "555-0100", links: {} },
  skills: ["Python"],
  education: [],
  experience: [],
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-write-tools-"));
  db = createDb(join(dir, "t.db"));
  applicationId = createApplication(db, {
    jobInfo: { jobId: "j", jobTitle: "Engineer", companyName: "Acme" },
  }).id;
  saveProfile(db, PROFILE);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ctx = () => ({ db, applicationId, reason: "test" });

describe("save_answer / delete_answer", () => {
  it("creates, updates answer-only, and deletes — verified against the bank", async () => {
    const created = await runTool(saveAnswerTool, ctx(), {
      question: "Are you willing to relocate?",
      answer: "Yes",
    });
    expect(created.ok).toBe(true);
    // verify-by-re-read is recorded on the trace, not the return value
    expect(listTrace(db, applicationId).at(-1)?.verified).toBe(true);

    const updated = await runTool(saveAnswerTool, ctx(), {
      question: "are you willing to relocate", // different casing/punctuation
      answer: "Yes, within the US",
    });
    expect(updated.ok).toBe(true);
    // Answer-only update: still ONE entry, patterns untouched.
    const bank = listAnswers(db);
    expect(bank).toHaveLength(1);
    expect(bank[0]!.answer).toBe("Yes, within the US");

    const deleted = await runTool(deleteAnswerTool, ctx(), {
      question: "Are you willing to relocate?",
    });
    expect(deleted.ok).toBe(true);
    expect(listAnswers(db)).toHaveLength(0);
  });

  it("deleting an unknown answer is a precondition failure, not a crash", async () => {
    const out = await runTool(deleteAnswerTool, ctx(), { question: "never asked" });
    expect(out.ok).toBe(false);
    expect(out.failure?.kind).toBe("precondition");
  });
});

describe("update_application", () => {
  it("records an interview and verifies against the row", async () => {
    const out = await runTool(updateApplicationTool, ctx(), {
      status: "interview",
      notes: "phone screen Tuesday",
    });
    expect(out.ok).toBe(true);
    const row = getApplication(db, applicationId)!;
    expect(row.status).toBe("interview");
    expect(row.notes).toBe("phone screen Tuesday");
  });

  it('refuses status "applied" — the submit gate is not a side door', async () => {
    // parse throws → runTool reports a precondition failure; the row is untouched.
    const out = await runTool(updateApplicationTool, ctx(), { status: "applied" });
    expect(out.ok).toBe(false);
    expect(getApplication(db, applicationId)!.status).toBe("saved");
  });
});

describe("update_profile", () => {
  it("patches personal fields and edits skills, verified by re-read", async () => {
    const out = await runTool(updateProfileTool, ctx(), {
      personal: { city: "Boston" },
      addSkills: ["TypeScript"],
      removeSkills: ["Python"],
    });
    expect(out.ok).toBe(true);
    const profile = getProfile(db)!;
    expect(profile.personal.city).toBe("Boston");
    expect(profile.skills).toEqual(["TypeScript"]);
  });

  it("refuses fields outside the patchable set", async () => {
    const out = await runTool(updateProfileTool, ctx(), {
      personal: { links: "https://example.com" } as never,
    });
    expect(out.ok).toBe(false);
  });
});

describe("chat threads", () => {
  it("windows the most recent N in prompt order and loads full threads", () => {
    for (let i = 1; i <= 12; i++) {
      appendChatMessage(db, {
        scope: applicationId,
        role: i % 2 === 1 ? "user" : "assistant",
        content: `m${i}`,
      });
    }
    appendChatMessage(db, { scope: "global", role: "user", content: "other thread" });

    const window = listRecentMessages(db, applicationId, 10);
    expect(window).toHaveLength(10);
    expect(window[0]!.content).toBe("m3"); // oldest-first, last 10 of 12
    expect(window[9]!.content).toBe("m12");

    expect(listThread(db, applicationId)).toHaveLength(12);
    expect(listThread(db, "global")).toHaveLength(1); // scopes never bleed
  });
});
