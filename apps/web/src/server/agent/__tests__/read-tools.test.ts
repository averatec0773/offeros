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

import { updateApplication } from "../../repositories/application-repo";
import { saveFit } from "../../repositories/fit-repo";
import { upsertArtifact } from "../../repositories/artifact-repo";
import { insertResumeRow } from "../../repositories/resume-repo";
import { readApplicationTool, readResumeTool, readArtifactTool } from "../read-tools";

describe("read_application surfaces JD, notes, and fit gaps (data that was on disk but hidden)", () => {
  it("returns the job description, the note, and the fit gaps", async () => {
    const appId = createApplication(db, {
      jobInfo: { jobId: "j1", jobTitle: "AI Engineer", companyName: "Acme" },
      jdText: "We need strong Kubernetes and Go experience for our platform team.",
    }).id;
    updateApplication(db, appId, { notes: "Referred by Sam" });
    saveFit(db, {
      id: "fit-1",
      applicationId: appId,
      version: 1,
      overall: 62,
      label: "partial match",
      subScores: { experience: 60, skills: 55, education: 70 },
      whyMatch: "Strong ML background",
      alignedSkills: [{ skill: "Python", evidence: "3 yrs" }],
      notAlignedSkills: [
        { skill: "Kubernetes", advice: "learn it" },
        { skill: "Go", advice: "learn it" },
      ],
      createdAt: Date.now(),
    });

    const obs = await readApplicationTool.run({ db, applicationId: appId }, undefined);
    const r = obs.result as {
      jdText?: string;
      notes?: string;
      fit?: { gaps?: string[]; whyMatch?: string };
    };
    expect(r.jdText).toContain("Kubernetes and Go");
    expect(r.notes).toBe("Referred by Sam");
    expect(r.fit?.gaps).toEqual(["Kubernetes", "Go"]);
    expect(r.fit?.whyMatch).toBe("Strong ML background");
  });

  it("says a job has no JD stored rather than pretending", async () => {
    const appId = createApplication(db, {
      jobInfo: { jobId: "j2", jobTitle: "Eng", companyName: "Beta" },
    }).id;
    const obs = await readApplicationTool.run({ db, applicationId: appId }, undefined);
    expect(obs.summary).toContain("no JD stored");
    expect((obs.result as { jdText?: string }).jdText).toBeUndefined();
  });
});

describe("read_resume returns the résumé text, honestly when there is none", () => {
  it("returns the primary résumé's text", async () => {
    const appId = createApplication(db, {
      jobInfo: { jobId: "j3", jobTitle: "Eng", companyName: "Acme" },
    }).id;
    insertResumeRow(db, {
      id: "r1",
      name: "My_Resume.pdf",
      mimeType: "application/pdf",
      isPrimary: true,
      targetRole: null,
      note: null,
      text: "Jordan Rivera — Software Engineer. Led the widget pipeline.",
      filePath: "/tmp/x.pdf",
      createdAt: Date.now(),
    });
    const obs = await readResumeTool.run({ db, applicationId: appId }, undefined);
    const r = obs.result as { text?: string; hasText: boolean };
    expect(r.hasText).toBe(true);
    expect(r.text).toContain("widget pipeline");
  });

  it("says the résumé has no extracted text instead of a dead 'can't read it'", async () => {
    const appId = createApplication(db, {
      jobInfo: { jobId: "j4", jobTitle: "Eng", companyName: "Acme" },
    }).id;
    insertResumeRow(db, {
      id: "r2",
      name: "Scan.pdf",
      mimeType: "application/pdf",
      isPrimary: true,
      targetRole: null,
      note: null,
      text: "",
      filePath: "/tmp/scan.pdf",
      createdAt: Date.now(),
    });
    const obs = await readResumeTool.run({ db, applicationId: appId }, undefined);
    expect(obs.ok).toBe(true);
    expect(obs.summary).toContain("no extracted text");
    expect((obs.result as { hasText: boolean }).hasText).toBe(false);
  });
});

describe("read_artifact hands back the generated résumé/letter the user never saw", () => {
  it("returns the current tailored-résumé version's content", async () => {
    const appId = createApplication(db, {
      jobInfo: { jobId: "j5", jobTitle: "Eng", companyName: "Acme" },
    }).id;
    const task = createPipelineTask(db, { applicationId: appId });
    const now = Date.now();
    upsertArtifact(db, {
      id: "art-1",
      taskId: task.id,
      kind: "resume",
      versions: [
        { id: "v1", content: "old", rationale: "", createdAt: now },
        {
          id: "v2",
          content: "TAILORED: emphasises distributed systems.",
          rationale: "for SDE",
          createdAt: now,
        },
      ],
      currentVersionId: "v2",
      createdAt: now,
      updatedAt: now,
    });
    const obs = await readArtifactTool.run(
      { db, applicationId: appId, taskId: task.id },
      { kind: "resume" },
    );
    const r = obs.result as { content: string; version: number; rationale?: string };
    expect(r.content).toContain("distributed systems");
    expect(r.version).toBe(2);
    expect(r.rationale).toBe("for SDE");
  });

  it("is honest when nothing has been generated yet", async () => {
    const appId = createApplication(db, {
      jobInfo: { jobId: "j6", jobTitle: "Eng", companyName: "Acme" },
    }).id;
    const task = createPipelineTask(db, { applicationId: appId });
    const obs = await readArtifactTool.run(
      { db, applicationId: appId, taskId: task.id },
      { kind: "cover-letter" },
    );
    expect(obs.ok).toBe(false);
    expect(obs.summary).toContain("no cover letter has been generated");
  });
});

import { saveProfile } from "../../repositories/profile-repo";
import { readProfileTool } from "../read-tools";

describe("read_profile now returns the structured background, not just skills", () => {
  it("surfaces experience and education so 'analyse my background' works without PDF text", async () => {
    saveProfile(db, {
      personal: { name: "Jordan Rivera", email: "j@example.com", phone: "555", links: {} },
      skills: ["Python", "SQL"],
      education: [
        {
          id: "e1",
          school: "State U",
          degree: "BS",
          field: "CS",
          start: "2019",
          end: "2023",
        },
      ],
      experience: [
        {
          id: "x1",
          company: "Acme",
          title: "ML Engineer",
          start: "2023",
          end: "present",
          bullets: ["Built the ranking pipeline", "Cut latency 40%"],
        },
      ],
    });
    const obs = await readProfileTool.run({ db, applicationId: appId }, undefined);
    const r = obs.result as {
      experience: { title: string; company: string; bullets: string[] }[];
      education: { degree: string; school: string }[];
    };
    expect(r.experience[0]).toMatchObject({ title: "ML Engineer", company: "Acme" });
    expect(r.experience[0]!.bullets).toContain("Cut latency 40%");
    expect(r.education[0]).toMatchObject({ degree: "BS", school: "State U" });
  });
});
