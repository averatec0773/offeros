import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPELINE_STEPS, type FieldReport, type Profile } from "@offeros/core";

const dir = mkdtempSync(join(tmpdir(), "offeros-fill-api-"));
process.env.OFFEROS_DB_PATH = join(dir, "fill.db");

const handoffRoute = await import("../agent/tasks/[id]/fill/handoff/route");
const reportRoute = await import("../agent/tasks/[id]/fill/report/route");
const answerRoute = await import("../agent/tasks/[id]/fill/answer/route");
const resolveRoute = await import("../agent/tasks/[id]/fill/resolve/route");
const pendingRoute = await import("../agent/fill/pending/route");
const claimRoute = await import("../agent/fill/handoffs/[id]/claim/route");

const { getDb } = await import("@/server/db/client");
const { saveProfile } = await import("@/server/repositories/profile-repo");
const { createApplication, getApplication } =
  await import("@/server/repositories/application-repo");
const { createPipelineTask, updatePipelineTask } =
  await import("@/server/repositories/pipeline-task-repo");
const { __setTestPipelineOverride } = await import("@/server/pipeline/route-context");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const FILL_FORM_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "fill-form");
const SUBMIT_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "submit");

const PROFILE: Profile = {
  personal: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "555-0100",
    city: "Austin",
    links: { linkedin: "https://linkedin.com/in/jordan" },
  },
  skills: ["Python", "TypeScript"],
  education: [],
  experience: [],
};

const ANSWER_OUTPUT = { answer: "I have five years of Python experience shipping ML systems." };

async function fakeRunLlm(taskId: string, _input: unknown): Promise<unknown> {
  if (taskId === "question-answer") return ANSWER_OUTPUT;
  throw new Error(`fill-routes.test fakeRunLlm: unexpected task id ${taskId}`);
}

__setTestPipelineOverride({ runLlm: fakeRunLlm });

function post(body?: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

function seedTaskAtFillForm(): { taskId: string; applicationId: string } {
  const db = getDb();
  const app = createApplication(db, {
    jobInfo: {
      jobId: `j-${Math.random().toString(36).slice(2)}`,
      jobTitle: "GenAI Engineer",
      companyName: "Evolver",
      applyLink: "https://apply.example.com/job/1",
    },
  });
  const task = createPipelineTask(db, { applicationId: app.id });
  updatePipelineTask(db, task.id, { step: FILL_FORM_STEP, status: "awaiting_user" });
  return { taskId: task.id, applicationId: app.id };
}

function report(over: Partial<FieldReport> & Pick<FieldReport, "fieldId">): FieldReport {
  return {
    label: over.label ?? over.fieldId,
    classifiedType: "unknown",
    status: "filled",
    source: "personal",
    reason: "",
    outcome: "filled",
    required: true,
    ...over,
  };
}

beforeEach(() => saveProfile(getDb(), PROFILE));

describe("POST /agent/tasks/[id]/fill/handoff", () => {
  it("opens a pending ticket for a task at the fill-form gate", async () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    const res = await handoffRoute.POST(post(), idCtx(taskId));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.status).toBe("pending");
    expect(body.result.taskId).toBe(taskId);
    expect(body.result.applicationId).toBe(applicationId);
  });

  it("404s for a missing task", async () => {
    const res = await handoffRoute.POST(post(), idCtx("does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("400s when the task is not at the fill-form gate", async () => {
    const { taskId } = seedTaskAtFillForm();
    updatePipelineTask(getDb(), taskId, { step: 0, status: "awaiting_user" });
    const res = await handoffRoute.POST(post(), idCtx(taskId));
    expect(res.status).toBe(400);
  });
});

describe("GET /agent/fill/pending", () => {
  it("lists open tickets with their job header", async () => {
    const { taskId } = seedTaskAtFillForm();
    await handoffRoute.POST(post(), idCtx(taskId));
    const res = await pendingRoute.GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    const ticket = body.result.find((t: { taskId: string }) => t.taskId === taskId);
    expect(ticket).toBeDefined();
    expect(ticket.job).toEqual({
      title: "GenAI Engineer",
      company: "Evolver",
      applyLink: "https://apply.example.com/job/1",
    });
  });
});

describe("POST /agent/fill/handoffs/[id]/claim", () => {
  it("claims a pending ticket and returns the fill bundle", async () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = await (await handoffRoute.POST(post(), idCtx(taskId))).json();
    const res = await claimRoute.POST(post(), idCtx(handoff.result.id));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.taskId).toBe(taskId);
    expect(body.result.fillProfile.personal.name).toBe("Jordan Rivera");
    expect(body.result.job.title).toBe("GenAI Engineer");
  });

  it("404s for a missing handoff", async () => {
    const res = await claimRoute.POST(post(), idCtx("nope"));
    expect(res.status).toBe(404);
  });

  it("re-claiming an already-claimed ticket succeeds (panel-reload recovery)", async () => {
    const { taskId } = seedTaskAtFillForm();
    const handoff = await (await handoffRoute.POST(post(), idCtx(taskId))).json();
    await claimRoute.POST(post(), idCtx(handoff.result.id));
    const res = await claimRoute.POST(post(), idCtx(handoff.result.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.taskId).toBe(taskId);
  });
});

describe("POST /agent/tasks/[id]/fill/report", () => {
  it("folds reports and advances to the submit gate when complete and all filled", async () => {
    const { taskId } = seedTaskAtFillForm();
    const res = await reportRoute.POST(
      post({ reports: [report({ fieldId: "email" })], complete: true }),
      idCtx(taskId),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.applicationInfo.status).toBe(1);
    expect(body.result.step).toBe(SUBMIT_STEP);
    expect(body.result.status).toBe("awaiting_user");
  });

  it("404s for a missing task", async () => {
    const res = await reportRoute.POST(post({ reports: [] }), idCtx("does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("400s a malformed report body", async () => {
    const { taskId } = seedTaskAtFillForm();
    const res = await reportRoute.POST(
      post({ reports: [{ label: "no field id" }] }),
      idCtx(taskId),
    );
    expect(res.status).toBe(400);
  });

  it("accepts a report at the submit gate — the user is still working on the page", async () => {
    // Between a finished fill and actually pressing submit, the user refines an
    // answer or fixes a field by hand, and the panel reports each as it
    // happens. This used to 400, so the record stopped matching the page at
    // exactly the moment it mattered most.
    const { taskId } = seedTaskAtFillForm();
    updatePipelineTask(getDb(), taskId, { step: SUBMIT_STEP, status: "awaiting_user" });
    const res = await reportRoute.POST(post({ reports: [], complete: false }), idCtx(taskId));
    expect(res.status).toBe(200);
  });

  it("400s once the task is finished", async () => {
    // The line that still holds: a late report from a stale panel must not
    // reopen a record the user has already closed.
    const { taskId } = seedTaskAtFillForm();
    updatePipelineTask(getDb(), taskId, { step: SUBMIT_STEP, status: "done" });
    const res = await reportRoute.POST(post({ reports: [], complete: false }), idCtx(taskId));
    expect(res.status).toBe(400);
  });
});

describe("POST /agent/tasks/[id]/fill/answer", () => {
  it("returns a generated answer using the fake provider", async () => {
    const { taskId } = seedTaskAtFillForm();
    const res = await answerRoute.POST(
      post({ question: "Why do you want this role?", label: "Motivation" }),
      idCtx(taskId),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.answer).toBe(ANSWER_OUTPUT.answer);
  });

  it("404s for a missing task", async () => {
    const res = await answerRoute.POST(
      post({ question: "q", label: "l" }),
      idCtx("does-not-exist"),
    );
    expect(res.status).toBe(404);
  });

  it("400s when the question is empty", async () => {
    const { taskId } = seedTaskAtFillForm();
    const res = await answerRoute.POST(post({ question: "", label: "l" }), idCtx(taskId));
    expect(res.status).toBe(400);
  });
});

describe("POST /agent/tasks/[id]/fill/resolve", () => {
  it("'fixed' clears the outstanding fields and advances to the submit gate", async () => {
    const { taskId } = seedTaskAtFillForm();
    await reportRoute.POST(
      post({
        reports: [
          report({ fieldId: "email", outcome: "filled" }),
          report({ fieldId: "eeo", outcome: "needs-user" }),
        ],
        complete: true,
      }),
      idCtx(taskId),
    );
    const res = await resolveRoute.POST(post({ action: "fixed" }), idCtx(taskId));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.applicationInfo.status).toBe(1);
    expect(body.result.step).toBe(SUBMIT_STEP);
  });

  it("'applied-manually' finishes the task and marks the application applied", async () => {
    const { taskId, applicationId } = seedTaskAtFillForm();
    const res = await resolveRoute.POST(post({ action: "applied-manually" }), idCtx(taskId));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.status).toBe("done");
    expect(getApplication(getDb(), applicationId)?.status).toBe("applied");
  });

  it("400s 'fixed' when the task has no outstanding fields", async () => {
    const { taskId } = seedTaskAtFillForm();
    const res = await resolveRoute.POST(post({ action: "fixed" }), idCtx(taskId));
    expect(res.status).toBe(400);
  });

  it("400s a bad action value", async () => {
    const { taskId } = seedTaskAtFillForm();
    const res = await resolveRoute.POST(post({ action: "maybe" }), idCtx(taskId));
    expect(res.status).toBe(400);
  });

  it("404s for a missing task", async () => {
    const res = await resolveRoute.POST(post({ action: "fixed" }), idCtx("does-not-exist"));
    expect(res.status).toBe(404);
  });
});
