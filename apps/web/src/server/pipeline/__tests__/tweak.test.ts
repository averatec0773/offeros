import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildResumeHeader, serializeResume, type PipelineTask, type Profile } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import { createApplication, updateApplication } from "../../repositories/application-repo";
import { createPipelineTask } from "../../repositories/pipeline-task-repo";
import { saveProfile } from "../../repositories/profile-repo";
import { uploadResume } from "../../services/resume-service";
import { listEvents } from "../../repositories/application-event-repo";
import { upsertStyleMemory } from "../../repositories/style-memory-repo";
import { makePipelineContext } from "../context";
import { tweakArtifact } from "../tweak";
import { run as tailorResumeRun } from "../steps/tailor-resume";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-tweak-"));
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
  skills: ["Python", "Machine Learning"],
  education: [],
  experience: [
    {
      id: "x1",
      company: "Acme",
      title: "ML Engineer",
      start: "2021",
      end: "Present",
      bullets: ["Led the ML pipeline redesign"],
    },
  ],
};

const RESUME_STRUCTURED = {
  summary: "ML engineer focused on inference pipelines.",
  experience: [
    {
      company: "Acme",
      title: "ML Engineer",
      dates: "2021 – Present",
      bullets: ["Led the ML pipeline redesign."],
    },
  ],
  education: [],
  skills: ["Python", "Machine Learning"],
};

const RESUME_TWEAK_STRUCTURED = {
  ...RESUME_STRUCTURED,
  experience: [{ ...RESUME_STRUCTURED.experience[0]!, bullets: ["Added a metrics line."] }],
};

const RESUME_OUTPUT = {
  structured: RESUME_STRUCTURED,
  rationale: "Initial tailored draft.",
  changedLines: ["Led the ML pipeline redesign."],
};

const RESUME_TWEAK_OUTPUT = {
  structured: RESUME_TWEAK_STRUCTURED,
  rationale: "Applied the tweak instruction.",
  changedLines: ["Added a metrics line."],
};

function seed(): { applicationId: string; task: PipelineTask } {
  const app = createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
    jdText: "We are hiring an ML Engineer to own our inference pipeline.",
  });
  saveProfile(db, profile);
  const task = createPipelineTask(db, { applicationId: app.id });
  return { applicationId: app.id, task };
}

describe("tweakArtifact (resume)", () => {
  it("resolves the application's selected résumé's text for the tweak's resume-tailor call", async () => {
    const { applicationId, task } = seed();

    // First tailor with no résumé selected — creates the artifact tweak() will revise.
    const ctx = makePipelineContext(db, task.id, {
      runLlm: async (taskId) => {
        if (taskId === "resume-tailor") return RESUME_OUTPUT;
        throw new Error(`unexpected task id ${taskId}`);
      },
    });
    await tailorResumeRun(ctx, task);

    const resume = uploadResume(db, {
      name: "jordan-resume.pdf",
      mimeType: "application/pdf",
      dataBase64: Buffer.from("pdf bytes").toString("base64"),
      text: "Actual résumé body pulled from the stored upload.",
    });
    updateApplication(db, applicationId, { resumeId: resume.id });

    let capturedResumeText: string | undefined;
    const tweakCtx = makePipelineContext(db, task.id, {
      runLlm: async (taskId, input) => {
        if (taskId === "resume-tailor") {
          capturedResumeText = (input as { resumeText: string }).resumeText;
          return RESUME_TWEAK_OUTPUT;
        }
        throw new Error(`unexpected task id ${taskId}`);
      },
    });

    const { version, diff } = await tweakArtifact(tweakCtx, "resume", "Add a metrics line.");

    expect(capturedResumeText).toBe("Actual résumé body pulled from the stored upload.");
    expect(version.content).toBe(
      serializeResume(RESUME_TWEAK_STRUCTURED, buildResumeHeader(profile)),
    );
    expect(version.resumeData).toEqual(RESUME_TWEAK_STRUCTURED);
    expect(diff.some((d) => d.op === "add")).toBe(true);
  });

  it("persists the instruction on the new version and appends an artifact-tweaked event", async () => {
    const { applicationId, task } = seed();

    const ctx = makePipelineContext(db, task.id, {
      runLlm: async (taskId) => {
        if (taskId === "resume-tailor") return RESUME_OUTPUT;
        throw new Error(`unexpected task id ${taskId}`);
      },
    });
    await tailorResumeRun(ctx, task);

    const tweakCtx = makePipelineContext(db, task.id, {
      runLlm: async (taskId) => {
        if (taskId === "resume-tailor") return RESUME_TWEAK_OUTPUT;
        throw new Error(`unexpected task id ${taskId}`);
      },
    });
    const { version } = await tweakArtifact(tweakCtx, "resume", "Add a metrics line.");

    expect(version.instruction).toBe("Add a metrics line.");

    const events = listEvents(db, applicationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "artifact-tweaked",
      applicationId,
      payload: { kind: "resume", instruction: "Add a metrics line." },
    });
  });

  it("passes the stored resume style notes through to the tweak's resume-tailor call", async () => {
    const { task } = seed();
    upsertStyleMemory(db, "resume", { notes: "- Prefers active voice.", sourceCount: 1 });

    const ctx = makePipelineContext(db, task.id, {
      runLlm: async (taskId) => {
        if (taskId === "resume-tailor") return RESUME_OUTPUT;
        throw new Error(`unexpected task id ${taskId}`);
      },
    });
    await tailorResumeRun(ctx, task);

    let capturedStyleNotes: unknown;
    const tweakCtx = makePipelineContext(db, task.id, {
      runLlm: async (taskId, input) => {
        if (taskId === "resume-tailor") {
          capturedStyleNotes = (input as { styleNotes?: string }).styleNotes;
          return RESUME_TWEAK_OUTPUT;
        }
        throw new Error(`unexpected task id ${taskId}`);
      },
    });
    await tweakArtifact(tweakCtx, "resume", "Add a metrics line.");

    expect(capturedStyleNotes).toBe("- Prefers active voice.");
  });
});

describe("tweakArtifact (cover-letter) — style notes wiring", () => {
  it("passes the stored cover-letter style notes through to the tweak's cover-letter call", async () => {
    const { task } = seed();
    upsertStyleMemory(db, "cover-letter", { notes: "- Warm, confident tone.", sourceCount: 1 });

    const ctx = makePipelineContext(db, task.id, {
      runLlm: async () => ({ content: "x", rationale: "" }),
    });
    ctx.repos.upsertArtifact({
      id: "cl-1",
      taskId: task.id,
      kind: "cover-letter",
      versions: [
        {
          id: "v1",
          content: "Dear Hiring Team,\n\nFirst draft.",
          rationale: "r",
          createdAt: Date.now(),
        },
      ],
      currentVersionId: "v1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    let capturedStyleNotes: unknown;
    const tweakCtx = makePipelineContext(db, task.id, {
      runLlm: async (taskId, input) => {
        if (taskId === "cover-letter") {
          capturedStyleNotes = (input as { styleNotes?: string }).styleNotes;
          return { content: "Dear Hiring Team,\n\nRevised.", rationale: "Applied the tweak." };
        }
        throw new Error(`unexpected task id ${taskId}`);
      },
    });
    await tweakArtifact(tweakCtx, "cover-letter", "Make it warmer.");

    expect(capturedStyleNotes).toBe("- Warm, confident tone.");
  });
});
