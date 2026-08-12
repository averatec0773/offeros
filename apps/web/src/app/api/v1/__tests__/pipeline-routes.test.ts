import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Profile } from "@offeros/core";

const dir = mkdtempSync(join(tmpdir(), "offeros-pipeline-api-"));
process.env.OFFEROS_DB_PATH = join(dir, "pipeline.db");

const tasksRoute = await import("../agent/tasks/route");
const taskRoute = await import("../agent/tasks/[id]/route");
const tweakRoute = await import("../agent/tasks/[id]/tweak/route");
const { getDb } = await import("@/server/db/client");
const { saveProfile } = await import("@/server/repositories/profile-repo");
const { __setTestPipelineOverride } = await import("@/server/pipeline/route-context");

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

/**
 * What survives of the pipeline routes.
 *
 * `start` / `advance` / `choice` / `pause` were the seven-step approval flow's
 * controls, and the flow was retired when an application became a record rather
 * than a workflow. They kept a deprecation window; it is over. What is left
 * here is what the record still uses: creating a task, reading one back, and
 * revising a generated document.
 */
describe("/api/v1/agent/tasks", () => {
  it("creates a task from a job description and reads it back", async () => {
    const taskId = await createTaskFromJd();
    const got = await (await taskRoute.GET(new Request("http://localhost"), idCtx(taskId))).json();
    expect(got.result.task.id).toBe(taskId);
    expect(Array.isArray(got.result.artifacts)).toBe(true);
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

  it("404s tweak and GET for a missing task", async () => {
    const missing = idCtx("does-not-exist");
    expect(
      (await tweakRoute.POST(post({ kind: "resume", instruction: "x" }), missing)).status,
    ).toBe(404);
    expect((await taskRoute.GET(new Request("http://localhost"), missing)).status).toBe(404);
  });

  it("400s a tweak with a bad kind or empty instruction", async () => {
    const taskId = await createTaskFromJd();
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
});
