import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeResume, type Profile } from "@offeros/core";

const dir = mkdtempSync(join(tmpdir(), "offeros-pipeline-api-"));
process.env.OFFEROS_DB_PATH = join(dir, "pipeline.db");

const tasksRoute = await import("../agent/tasks/route");
const taskRoute = await import("../agent/tasks/[id]/route");
const startRoute = await import("../agent/tasks/[id]/start/route");
const advanceRoute = await import("../agent/tasks/[id]/advance/route");
const choiceRoute = await import("../agent/tasks/[id]/choice/route");
const tweakRoute = await import("../agent/tasks/[id]/tweak/route");
const pauseRoute = await import("../agent/tasks/[id]/pause/route");
const { getDb } = await import("@/server/db/client");
const { saveProfile } = await import("@/server/repositories/profile-repo");
const { __setTestPipelineOverride } = await import("@/server/pipeline/route-context");
const { buildResumeHeader } = await import("@/server/pipeline/steps/grounding");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

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
saveProfile(getDb(), profile);

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

const RESUME_TWEAK_STRUCTURED = {
  ...RESUME_STRUCTURED,
  experience: [{ ...RESUME_STRUCTURED.experience[0]!, bullets: ["Added a metrics line."] }],
};

const RESUME_OUTPUT = {
  structured: RESUME_STRUCTURED,
  rationale: "Emphasized ML pipeline experience to match the JD.",
  changedLines: ["Led the ML pipeline redesign, cutting latency 40%."],
};

const RESUME_TWEAK_OUTPUT = {
  structured: RESUME_TWEAK_STRUCTURED,
  rationale: "Applied the tweak instruction.",
  changedLines: ["Added a metrics line."],
};

const RESUME_CONTENT = serializeResume(RESUME_STRUCTURED, buildResumeHeader(profile));
const RESUME_TWEAK_CONTENT = serializeResume(RESUME_TWEAK_STRUCTURED, buildResumeHeader(profile));

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

async function fakeRunLlm(taskId: string, input: unknown): Promise<unknown> {
  const hasInstruction = (input as { instruction?: string }).instruction !== undefined;
  if (taskId === "resume-tailor") return hasInstruction ? RESUME_TWEAK_OUTPUT : RESUME_OUTPUT;
  if (taskId === "jd-analysis") return JD_OUTPUT;
  if (taskId === "cover-letter") return COVER_OUTPUT;
  throw new Error(`pipeline-routes.test fakeRunLlm: unexpected task id ${taskId}`);
}

__setTestPipelineOverride({ runLlm: fakeRunLlm });

function post(body?: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

async function createTaskFromJd(): Promise<string> {
  const res = await tasksRoute.POST(
    post({
      jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
      jdText: "We are hiring an ML Engineer to own our inference pipeline.",
      source: "test-fixture",
    }),
  );
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.result.status).toBe("queued");
  return body.result.id as string;
}

describe("/api/v1/agent/tasks/[id] pipeline actions", () => {
  it("runs the full pipeline via start/advance/choice through the fill-form boundary, then tweaks the cover letter", async () => {
    const taskId = await createTaskFromJd();

    const afterStart = await (await startRoute.POST(post(), idCtx(taskId))).json();
    expect(afterStart.result.status).toBe("awaiting_user");

    const afterResumeConfirm = await (await advanceRoute.POST(post(), idCtx(taskId))).json();
    expect(afterResumeConfirm.result.status).toBe("awaiting_user");
    expect(afterResumeConfirm.result.coverLetterRequirement).toBe("optional");

    const afterChoice = await (
      await choiceRoute.POST(post({ choice: "generate" }), idCtx(taskId))
    ).json();
    expect(afterChoice.result.status).toBe("awaiting_user");

    const afterCoverConfirm = await (await advanceRoute.POST(post(), idCtx(taskId))).json();
    expect(afterCoverConfirm.result.status).toBe("awaiting_user"); // fill-form boundary

    // GET returns task + jdAnalysis + artifacts
    const got = await (await taskRoute.GET(new Request("http://localhost"), idCtx(taskId))).json();
    expect(got.result.task.id).toBe(taskId);
    expect(got.result.jdAnalysis.summary).toBe(JD_OUTPUT.summary);
    const kinds = got.result.artifacts.map((a: { kind: string }) => a.kind).sort();
    expect(kinds).toEqual(["cover-letter", "resume"]);

    // Tweak the résumé: new version + a non-trivial diff vs. the prior version
    const tweaked = await (
      await tweakRoute.POST(
        post({ kind: "resume", instruction: "Add a quantified metrics line." }),
        idCtx(taskId),
      )
    ).json();
    expect(tweaked.success).toBe(true);
    expect(tweaked.result.version.content).toBe(RESUME_TWEAK_CONTENT);
    expect(tweaked.result.version.id).not.toBe(undefined);
    expect(tweaked.result.diff.some((d: { op: string }) => d.op === "add")).toBe(true);
    expect(tweaked.result.diff.some((d: { op: string }) => d.op === "eq")).toBe(true);

    const afterTweak = await (
      await taskRoute.GET(new Request("http://localhost"), idCtx(taskId))
    ).json();
    const resumeArtifact = afterTweak.result.artifacts.find(
      (a: { kind: string }) => a.kind === "resume",
    );
    expect(resumeArtifact.versions).toHaveLength(2);
    expect(resumeArtifact.currentVersionId).toBe(tweaked.result.version.id);
  });

  it("pause sets status to paused", async () => {
    const taskId = await createTaskFromJd();
    const paused = await (await pauseRoute.POST(post(), idCtx(taskId))).json();
    expect(paused.result.status).toBe("paused");
  });

  it("400s pausing a done/failed task, 200s a pausable one", async () => {
    const taskId = await createTaskFromJd(); // queued → pausable
    const okRes = await pauseRoute.POST(post(), idCtx(taskId));
    expect(okRes.status).toBe(200);

    const { updateAgentTask } = await import("@/server/repositories/agent-task-repo");
    updateAgentTask(getDb(), taskId, { status: "done" });
    const badRes = await pauseRoute.POST(post(), idCtx(taskId));
    expect(badRes.status).toBe(400);
  });

  it("404s start/advance/choice/tweak/pause/GET for a missing task", async () => {
    const missing = idCtx("does-not-exist");
    expect((await startRoute.POST(post(), missing)).status).toBe(404);
    expect((await advanceRoute.POST(post(), missing)).status).toBe(404);
    expect((await choiceRoute.POST(post({ choice: "skip" }), missing)).status).toBe(404);
    expect(
      (await tweakRoute.POST(post({ kind: "resume", instruction: "x" }), missing)).status,
    ).toBe(404);
    expect((await pauseRoute.POST(post(), missing)).status).toBe(404);
    expect((await taskRoute.GET(new Request("http://localhost"), missing)).status).toBe(404);
  });

  it("400s a tweak with a bad kind or empty instruction", async () => {
    const taskId = await createTaskFromJd();
    await startRoute.POST(post(), idCtx(taskId));
    await advanceRoute.POST(post(), idCtx(taskId));

    const badKind = await tweakRoute.POST(
      post({ kind: "nonsense", instruction: "do something" }),
      idCtx(taskId),
    );
    expect(badKind.status).toBe(400);

    const emptyInstruction = await tweakRoute.POST(
      post({ kind: "resume", instruction: "" }),
      idCtx(taskId),
    );
    expect(emptyInstruction.status).toBe(400);
  });

  it("400s a choice with a bad value", async () => {
    const taskId = await createTaskFromJd();
    await startRoute.POST(post(), idCtx(taskId));
    const res = await choiceRoute.POST(post({ choice: "maybe" }), idCtx(taskId));
    expect(res.status).toBe(400);
  });

  it("keeps the { applicationId } create path working (back-compat)", async () => {
    const db = getDb();
    const { createApplication } = await import("@/server/repositories/application-repo");
    const application = createApplication(db, {
      jobInfo: { jobId: "j2", jobTitle: "Data Scientist", companyName: "Beta" },
    });
    const created = await (await tasksRoute.POST(post({ applicationId: application.id }))).json();
    expect(created.result.applicationId).toBe(application.id);
  });
});
