import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Profile } from "@offeros/core";

const dir = mkdtempSync(join(tmpdir(), "offeros-fit-api-"));
process.env.OFFEROS_DB_PATH = join(dir, "fit.db");

const fitRoute = await import("../applications/[id]/fit/route");

const { getDb } = await import("@/server/db/client");
const { saveProfile } = await import("@/server/repositories/profile-repo");
const { createApplication } = await import("@/server/repositories/application-repo");
const { createAgentTask } = await import("@/server/repositories/agent-task-repo");
const { saveJdAnalysis } = await import("@/server/repositories/jd-analysis-repo");
const { __setTestPipelineOverride } = await import("@/server/pipeline/route-context");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PROFILE: Profile = {
  personal: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "555-0100",
    city: "Austin",
    links: { linkedin: "https://linkedin.com/in/jordan" },
  },
  skills: ["Python", "Machine Learning"],
  education: [],
  experience: [],
};

const FIT_OUTPUT = {
  overall: 82,
  label: "Strong match",
  subScores: { experience: 80, skills: 85, education: 70 },
  whyMatch: "Solid Python and ML background.",
  alignedSkills: [{ skill: "Python", evidence: "shipped ML systems" }],
  notAlignedSkills: [{ skill: "Kubernetes", advice: "Take a k8s course" }],
};

async function fakeRunLlm(taskId: string, _input: unknown): Promise<unknown> {
  if (taskId === "fit-analysis") return FIT_OUTPUT;
  throw new Error(`fit-routes.test fakeRunLlm: unexpected task id ${taskId}`);
}

__setTestPipelineOverride({ runLlm: fakeRunLlm });

saveProfile(getDb(), PROFILE);

function post(): Request {
  return new Request("http://localhost", { method: "POST" });
}
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

function seedApplication(): string {
  const app = createApplication(getDb(), {
    jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
    jdText: "We are hiring an ML Engineer.",
  });
  createAgentTask(getDb(), { applicationId: app.id });
  saveJdAnalysis(getDb(), {
    id: `jda-${app.id}`,
    applicationId: app.id,
    summary: "ML Engineer role",
    responsibilities: [],
    requiredSkills: ["Python", "Kubernetes"],
    preferredSkills: ["Machine Learning"],
    matchNotes: [],
    gaps: [],
    coverLetterRequirement: "optional",
    createdAt: Date.now(),
  });
  return app.id;
}

describe("/api/v1/applications/[id]/fit", () => {
  it("POST recomputes and returns the fit row", async () => {
    const appId = seedApplication();
    const res = await fitRoute.POST(post(), idCtx(appId));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.result.applicationId).toBe(appId);
    expect(body.result.overall).toBe(82);
    expect(body.result.label).toBe("Strong match");
  });

  it("GET returns the current row after a recompute", async () => {
    const appId = seedApplication();
    await fitRoute.POST(post(), idCtx(appId));
    const res = await fitRoute.GET(new Request("http://localhost"), idCtx(appId));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.overall).toBe(82);
  });

  it("GET returns notFound before any fit is computed", async () => {
    const appId = seedApplication();
    const res = await fitRoute.GET(new Request("http://localhost"), idCtx(appId));
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
  });

  it("POST on an unknown application returns notFound", async () => {
    const res = await fitRoute.POST(post(), idCtx("missing"));
    expect(res.status).toBe(404);
  });
});
