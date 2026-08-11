import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PipelineTask, Profile } from "@offeros/core";
import { makeFakeProvider, type ProviderCallArgs } from "@offeros/llm";
import { createDb, type Db } from "../../db/client";
import { createApplication } from "../../repositories/application-repo";
import { createPipelineTask } from "../../repositories/pipeline-task-repo";
import { saveProfile } from "../../repositories/profile-repo";
import { upsertTemplate } from "../../repositories/template-repo";
import { makePipelineContext } from "../context";
import { run as generateCoverLetterRun } from "../steps/generate-cover-letter";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-cover-letter-templates-"));
  db = createDb(join(dir, "s.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const profile: Profile = {
  personal: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "555-0100",
    city: "Austin",
    state: "TX",
    links: { linkedin: "https://linkedin.com/in/jordan" },
  },
  skills: ["Python"],
  education: [],
  experience: [],
};

const COVER_RESPONSE = JSON.stringify({
  content: "Dear Hiring Team,\n\nCanned cover letter body.",
  rationale: "Canned rationale.",
});

function seed(): PipelineTask {
  const app = createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
    jdText: "We are hiring an ML Engineer.",
  });
  saveProfile(db, profile);
  return createPipelineTask(db, { applicationId: app.id });
}

/** Captures the exact user prompt sent to the (fake) provider for the
 *  cover-letter task, going through the REAL runTask/buildUserPrompt path —
 *  only the network call is faked. */
function captureContext(db: Db, taskId: string, seen: string[]) {
  return makePipelineContext(db, taskId, {
    callProvider: makeFakeProvider((args: ProviderCallArgs) => {
      seen.push(args.userPrompt);
      return COVER_RESPONSE;
    }),
  });
}

describe("generate-cover-letter step — template-aware prompt", () => {
  it("is byte-identical to the no-template prompt when no default cover-letter template exists", async () => {
    const task = seed();
    const seen: string[] = [];
    const ctx = captureContext(db, task.id, seen);

    await generateCoverLetterRun(ctx, task);

    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain("User template constraints");
  });

  it("prepends the default template's scaffoldHints as a labeled block when one exists", async () => {
    const task = seed();
    const now = Date.now();
    upsertTemplate(db, {
      id: "tpl1",
      name: "averatec cover letter",
      kind: "cover-letter",
      renderer: "latex",
      content: "%% OFFEROS-BODY-START\n%% OFFEROS-BODY-END",
      scaffoldHints: 'Salutation: "Dear Hiring Team,". Closing: "Sincerely,". Body: 4 paragraphs.',
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });

    const seen: string[] = [];
    const ctx = captureContext(db, task.id, seen);
    await generateCoverLetterRun(ctx, task);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(
      'User template constraints:\nSalutation: "Dear Hiring Team,". Closing: "Sincerely,". Body: 4 paragraphs.',
    );
  });

  it("ignores a non-default cover-letter template", async () => {
    const task = seed();
    const now = Date.now();
    upsertTemplate(db, {
      id: "tpl1",
      name: "not the default",
      kind: "cover-letter",
      renderer: "latex",
      content: "%% OFFEROS-BODY-START\n%% OFFEROS-BODY-END",
      scaffoldHints: "Should not appear.",
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });

    const seen: string[] = [];
    const ctx = captureContext(db, task.id, seen);
    await generateCoverLetterRun(ctx, task);

    expect(seen[0]).not.toContain("User template constraints");
    expect(seen[0]).not.toContain("Should not appear.");
  });
});
