import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../db/client";
import { getProfile, saveProfile } from "../profile-repo";
import {
  listApplications,
  listApplicationsByJobUrl,
  getApplication,
  createApplication,
  updateApplication,
} from "../application-repo";
import { createAgentTask, listAgentTasks, updateAgentTask } from "../agent-task-repo";
import { getSettings, saveSettings } from "../settings-repo";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-repo-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("profile repo", () => {
  it("returns null before anything is saved, then round-trips", () => {
    expect(getProfile(db)).toBeNull();
    const saved = saveProfile(db, {
      personal: { name: "Jordan Rivera", email: "j@example.com", phone: "555", links: {} },
      skills: ["Python"],
      education: [],
      experience: [],
    });
    expect(saved.personal.name).toBe("Jordan Rivera");
    expect(getProfile(db)?.skills).toEqual(["Python"]);
  });

  it("overwrites the singleton rather than inserting twice", () => {
    const base = {
      personal: { name: "A", email: "a@b.c", phone: "1", links: {} },
      skills: [],
      education: [],
      experience: [],
    };
    saveProfile(db, base);
    saveProfile(db, { ...base, personal: { ...base.personal, name: "B" } });
    expect(getProfile(db)?.personal.name).toBe("B");
  });
});

describe("application repo", () => {
  it("creates, lists, gets and updates", () => {
    const created = createApplication(db, {
      jobInfo: { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver" },
    });
    expect(created.status).toBe("saved");
    expect(listApplications(db)).toHaveLength(1);
    expect(getApplication(db, created.id)?.jobInfo.jobTitle).toBe("GenAI Engineer");

    const updated = updateApplication(db, created.id, { status: "applied", notes: "sent" });
    expect(updated?.status).toBe("applied");
    expect(updated?.notes).toBe("sent");
  });

  it("persists and reads back a selected resumeId", () => {
    const created = createApplication(db, {
      jobInfo: { jobId: "j1", jobTitle: "T", companyName: "C" },
    });
    expect(created.resumeId).toBeUndefined();

    const updated = updateApplication(db, created.id, { resumeId: "resume-9" });
    expect(updated?.resumeId).toBe("resume-9");
    expect(getApplication(db, created.id)?.resumeId).toBe("resume-9");
  });

  it("returns null for a missing id", () => {
    expect(getApplication(db, "nope")).toBeNull();
    expect(updateApplication(db, "nope", { status: "applied" })).toBeNull();
  });

  it("lists only applications with a matching jobInfo.applyLink", () => {
    const jobUrl = "https://boards.greenhouse.io/acme/jobs/1";
    const match = createApplication(db, {
      jobInfo: { jobId: "j1", jobTitle: "T", companyName: "C", applyLink: jobUrl },
    });
    createApplication(db, {
      jobInfo: {
        jobId: "j2",
        jobTitle: "T2",
        companyName: "C2",
        applyLink: "https://example.com/other",
      },
    });
    createApplication(db, { jobInfo: { jobId: "j3", jobTitle: "T3", companyName: "C3" } });

    expect(listApplicationsByJobUrl(db, jobUrl)).toEqual([match]);
    expect(listApplicationsByJobUrl(db, "https://nomatch.example.com")).toEqual([]);
  });
});

describe("agent task repo", () => {
  it("creates a queued task and records the action-required gate", () => {
    const app = createApplication(db, {
      jobInfo: { jobId: "j1", jobTitle: "T", companyName: "C" },
    });
    const task = createAgentTask(db, { applicationId: app.id });
    expect(task.status).toBe("queued");
    expect(task.step).toBe(0);

    const gated = updateAgentTask(db, task.id, {
      status: "awaiting_user",
      step: 6,
      applicationInfo: {
        status: 2,
        filledFields: ["First Name"],
        missingFields: ["LinkedIn Profile"],
      },
    });
    expect(gated?.applicationInfo?.missingFields).toEqual(["LinkedIn Profile"]);
    expect(listAgentTasks(db)).toHaveLength(1);
  });

  it("defaults fieldReports to [] then round-trips through update", () => {
    const app = createApplication(db, {
      jobInfo: { jobId: "j1", jobTitle: "T", companyName: "C" },
    });
    const task = createAgentTask(db, { applicationId: app.id });
    expect(task.fieldReports).toEqual([]);

    const report = {
      fieldId: "f1",
      label: "First Name",
      classifiedType: "firstName",
      status: "filled",
      value: "Jordan",
      source: "personal",
      reason: "matched profile field",
      outcome: "filled" as const,
      required: true,
    };
    const updated = updateAgentTask(db, task.id, { fieldReports: [report] });
    expect(updated?.fieldReports).toEqual([report]);

    const reloaded = listAgentTasks(db).find((t) => t.id === task.id);
    expect(reloaded?.fieldReports).toEqual([report]);
  });
});

describe("settings repo", () => {
  it("returns defaults then persists changes", () => {
    expect(getSettings(db).agent.enableCustomizeResume).toBe(true);
    saveSettings(db, {
      agent: {
        enableCustomizeResume: false,
        enableCustomizeCoverLetter: true,
        useOriginalResume: false,
        autoConfirm: false,
      },
      llm: { provider: "anthropic", promptOverrides: {}, modelOverrides: {}, apiKeys: {} },
    });
    expect(getSettings(db).agent.enableCustomizeResume).toBe(false);
  });
});
