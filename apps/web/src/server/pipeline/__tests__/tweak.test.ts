import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeResume, type AgentTask, type Profile } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import { createApplication, updateApplication } from "../../repositories/application-repo";
import { createAgentTask } from "../../repositories/agent-task-repo";
import { saveProfile } from "../../repositories/profile-repo";
import { uploadResume } from "../../services/resume-service";
import { makePipelineContext } from "../context";
import { tweakArtifact } from "../tweak";
import { run as tailorResumeRun } from "../steps/tailor-resume";
import { buildResumeHeader } from "../steps/grounding";

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

function seed(): { applicationId: string; task: AgentTask } {
  const app = createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
    jdText: "We are hiring an ML Engineer to own our inference pipeline.",
  });
  saveProfile(db, profile);
  const task = createAgentTask(db, { applicationId: app.id });
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
});
