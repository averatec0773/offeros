import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPELINE_STEPS, serializeResume, type AgentTask, type Profile } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import { createApplication, updateApplication } from "../../repositories/application-repo";
import { createAgentTask } from "../../repositories/agent-task-repo";
import { saveProfile } from "../../repositories/profile-repo";
import { getFit } from "../../repositories/fit-repo";
import { uploadResume } from "../../services/resume-service";
import { makePipelineContext } from "../context";
import { advance, choose } from "../runner";
import { STEPS } from "../steps";
import { run as tailorResumeRun } from "../steps/tailor-resume";
import { run as analyzeSiteRun } from "../steps/analyze-site";
import { run as generateCoverLetterRun } from "../steps/generate-cover-letter";
import { run as confirmRun } from "../steps/confirm";
import { buildProfileFacts, buildResumeHeader } from "../steps/grounding";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-steps-"));
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
      bullets: ["Led the ML pipeline redesign", "Shipped a real-time inference service"],
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
      bullets: ["Led the ML pipeline redesign, cutting latency 40%."],
    },
  ],
  education: [],
  skills: ["Python", "Machine Learning"],
};

const RESUME_OUTPUT = {
  structured: RESUME_STRUCTURED,
  rationale: "Emphasized ML pipeline experience to match the JD.",
  changedLines: ["Led the ML pipeline redesign, cutting latency 40%."],
};

const RESUME_CONTENT = serializeResume(RESUME_STRUCTURED, buildResumeHeader(profile));

const JD_OUTPUT = {
  summary: "Strong fit for the ML Engineer role at Acme.",
  responsibilities: ["Build and ship ML models"],
  requiredSkills: ["Python"],
  preferredSkills: ["Kubernetes"],
  matchNotes: ["5 years of Python and ML pipeline experience"],
  gaps: ["No stated Kubernetes experience"],
  coverLetterRequirement: "optional" as const,
};

const COVER_OUTPUT = {
  content: "Dear Hiring Team,\n\nCanned cover letter body for the ML Engineer role.",
  rationale: "Leads with the ML pipeline redesign win.",
};

async function fakeRunLlm(taskId: string, _input: unknown): Promise<unknown> {
  if (taskId === "resume-tailor") return RESUME_OUTPUT;
  if (taskId === "jd-analysis") return JD_OUTPUT;
  if (taskId === "cover-letter") return COVER_OUTPUT;
  throw new Error(`steps.test fakeRunLlm: unexpected task id ${taskId}`);
}

function seed(): { applicationId: string; task: AgentTask } {
  const app = createApplication(db, {
    jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
    jdText: "We are hiring an ML Engineer to own our inference pipeline.",
  });
  saveProfile(db, profile);
  const task = createAgentTask(db, { applicationId: app.id });
  return { applicationId: app.id, task };
}

describe("tailor-resume step", () => {
  it("writes a resume artifact v1 with content and structured changedLines", async () => {
    const { task } = seed();
    const ctx = makePipelineContext(db, task.id, { runLlm: fakeRunLlm });

    await tailorResumeRun(ctx, task);

    const artifact = ctx.repos.getArtifact(task.id, "resume");
    expect(artifact).not.toBeNull();
    expect(artifact?.versions).toHaveLength(1);
    expect(artifact?.currentVersionId).toBe(artifact?.versions[0]!.id);
    expect(artifact?.versions[0]!.content).toBe(RESUME_CONTENT);
    expect(artifact?.versions[0]!.rationale).toBe(RESUME_OUTPUT.rationale);
    expect(artifact?.versions[0]!.rationale).not.toContain("Changed lines:");
    expect(artifact?.versions[0]!.changedLines).toEqual(RESUME_OUTPUT.changedLines);
    expect(artifact?.versions[0]!.resumeData).toEqual(RESUME_STRUCTURED);
  });

  it("appends a new version and preserves history when run again", async () => {
    const { task } = seed();
    const ctx = makePipelineContext(db, task.id, { runLlm: fakeRunLlm });

    await tailorResumeRun(ctx, task);
    const first = ctx.repos.getArtifact(task.id, "resume");
    await tailorResumeRun(ctx, task);
    const second = ctx.repos.getArtifact(task.id, "resume");

    expect(second).not.toBeNull();
    expect(second?.id).toBe(first?.id);
    expect(second?.createdAt).toBe(first?.createdAt);
    expect(second?.versions).toHaveLength(2);
    expect(second?.versions[0]!.id).toBe(first?.versions[0]!.id);
    expect(second?.currentVersionId).toBe(second?.versions[1]!.id);
    expect(second?.currentVersionId).not.toBe(first?.versions[0]!.id);
  });

  it("falls back to profile facts when the application has no résumé selected", async () => {
    const { task } = seed();
    let capturedResumeText: string | undefined;
    const capturingRunLlm = async (taskId: string, input: unknown) => {
      if (taskId === "resume-tailor")
        capturedResumeText = (input as { resumeText: string }).resumeText;
      return fakeRunLlm(taskId, input);
    };
    const ctx = makePipelineContext(db, task.id, { runLlm: capturingRunLlm });

    await tailorResumeRun(ctx, task);

    expect(capturedResumeText).toBe(buildProfileFacts(profile));
  });

  it("feeds the selected résumé's stored text, not profile facts", async () => {
    const { applicationId, task } = seed();
    const resume = uploadResume(db, {
      name: "jordan-resume.pdf",
      mimeType: "application/pdf",
      dataBase64: Buffer.from("pdf bytes").toString("base64"),
      text: "Actual résumé body pulled from the stored upload.",
    });
    updateApplication(db, applicationId, { resumeId: resume.id });

    let capturedResumeText: string | undefined;
    const capturingRunLlm = async (taskId: string, input: unknown) => {
      if (taskId === "resume-tailor")
        capturedResumeText = (input as { resumeText: string }).resumeText;
      return fakeRunLlm(taskId, input);
    };
    const ctx = makePipelineContext(db, task.id, { runLlm: capturingRunLlm });

    await tailorResumeRun(ctx, task);

    expect(capturedResumeText).toBe("Actual résumé body pulled from the stored upload.");
  });
});

describe("analyze-site step", () => {
  it("saves a jd-analysis with gaps and sets the task's coverLetterRequirement", async () => {
    const { applicationId, task } = seed();
    const ctx = makePipelineContext(db, task.id, { runLlm: fakeRunLlm });

    await analyzeSiteRun(ctx, task);

    const analysis = ctx.repos.getJdAnalysis(applicationId);
    expect(analysis).not.toBeNull();
    expect(analysis?.gaps).toEqual(JD_OUTPUT.gaps);
    expect(analysis?.matchNotes).toEqual(JD_OUTPUT.matchNotes);
    expect(analysis?.coverLetterRequirement).toBe("optional");

    const updated = ctx.repos.getAgentTask(task.id);
    expect(updated?.coverLetterRequirement).toBe("optional");
  });

  it("swallows a fit-analysis failure: the step still lands exactly as today", async () => {
    const { applicationId, task } = seed();
    // fakeRunLlm throws on the "fit-analysis" task id (unexpected), simulating a
    // fit LLM failure. The advisory hook must catch it and leave the step's
    // observable result identical to the run without fit scoring.
    const ctx = makePipelineContext(db, task.id, { runLlm: fakeRunLlm });

    await expect(analyzeSiteRun(ctx, task)).resolves.toBeUndefined();

    const analysis = ctx.repos.getJdAnalysis(applicationId);
    expect(analysis?.gaps).toEqual(JD_OUTPUT.gaps);
    expect(analysis?.coverLetterRequirement).toBe("optional");
    expect(ctx.repos.getAgentTask(task.id)?.coverLetterRequirement).toBe("optional");
    // No fit row was written, since fit computation threw.
    expect(getFit(db, applicationId)).toBeNull();
  });
});

describe("generate-cover-letter step", () => {
  it("writes a cover-letter artifact whose content starts with the canned letter", async () => {
    const { task } = seed();
    const ctx = makePipelineContext(db, task.id, { runLlm: fakeRunLlm });
    await tailorResumeRun(ctx, task); // so grounding facts include the tailored résumé
    await analyzeSiteRun(ctx, task); // so jdSummary is available

    await generateCoverLetterRun(ctx, task);

    const artifact = ctx.repos.getArtifact(task.id, "cover-letter");
    expect(artifact).not.toBeNull();
    expect(artifact?.versions).toHaveLength(1);
    expect(artifact?.versions[0]!.content.startsWith("Dear Hiring Team,")).toBe(true);
    expect(artifact?.versions[0]!.content).toBe(COVER_OUTPUT.content);
  });

  it("is skipped by shouldRun when the requirement is none", async () => {
    const { task } = seed();
    const ctx = makePipelineContext(db, task.id, { runLlm: fakeRunLlm });
    const step = STEPS.find((s) => s.key === "generate-cover-letter")!;
    const noneTask: AgentTask = { ...task, coverLetterRequirement: "none" };

    expect(await step.shouldRun(ctx, noneTask)).toBe(false);
  });

  it("appends a new version and preserves history when run again", async () => {
    const { task } = seed();
    const ctx = makePipelineContext(db, task.id, { runLlm: fakeRunLlm });
    await tailorResumeRun(ctx, task);
    await analyzeSiteRun(ctx, task);

    await generateCoverLetterRun(ctx, task);
    const first = ctx.repos.getArtifact(task.id, "cover-letter");
    await generateCoverLetterRun(ctx, task);
    const second = ctx.repos.getArtifact(task.id, "cover-letter");

    expect(second).not.toBeNull();
    expect(second?.id).toBe(first?.id);
    expect(second?.createdAt).toBe(first?.createdAt);
    expect(second?.versions).toHaveLength(2);
    expect(second?.versions[0]!.id).toBe(first?.versions[0]!.id);
    expect(second?.currentVersionId).toBe(second?.versions[1]!.id);
    expect(second?.currentVersionId).not.toBe(first?.versions[0]!.id);
  });
});

describe("confirm step", () => {
  it("is a pure no-op gate body", async () => {
    const { task } = seed();
    const ctx = makePipelineContext(db, task.id, { runLlm: fakeRunLlm });
    await expect(confirmRun(ctx, task)).resolves.toBeUndefined();
    expect(ctx.repos.getArtifact(task.id, "resume")).toBeNull();
    expect(ctx.repos.getArtifact(task.id, "cover-letter")).toBeNull();
  });
});

describe("full pipeline integration", () => {
  it("advances from queued through confirm-cover-letter, producing both artifacts", async () => {
    const { task } = seed();
    const ctx = makePipelineContext(db, task.id, { runLlm: fakeRunLlm });

    const afterResume = await advance(ctx); // runs tailor-resume, stops at confirm-resume
    expect(afterResume.status).toBe("awaiting_user");
    expect(PIPELINE_STEPS[afterResume.step]?.key).toBe("confirm-resume");

    const afterAnalyze = await advance(ctx); // approve résumé, runs analyze-site, stops at cover-letter choice
    expect(afterAnalyze.status).toBe("awaiting_user");
    expect(PIPELINE_STEPS[afterAnalyze.step]?.key).toBe("generate-cover-letter");
    expect(afterAnalyze.coverLetterRequirement).toBe("optional");

    const afterGenerate = await choose(ctx, "generate"); // runs generate-cover-letter
    expect(afterGenerate.status).toBe("awaiting_user");
    expect(PIPELINE_STEPS[afterGenerate.step]?.key).toBe("confirm-cover-letter");

    const resumeArtifact = ctx.repos.getArtifact(task.id, "resume");
    const coverArtifact = ctx.repos.getArtifact(task.id, "cover-letter");
    expect(resumeArtifact?.versions[0]!.content).toBe(RESUME_CONTENT);
    expect(coverArtifact?.versions[0]!.content).toBe(COVER_OUTPUT.content);

    const afterConfirmCover = await advance(ctx); // approve cover letter, stops at fill-form boundary
    expect(afterConfirmCover.status).toBe("awaiting_user");
    expect(PIPELINE_STEPS[afterConfirmCover.step]?.key).toBe("fill-form");
  });
});
