import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "offeros-onboarding-api-"));
process.env.OFFEROS_DB_PATH = join(dir, "onboarding.db");

const resumesRoute = await import("../resumes/route");
const resumeRoute = await import("../resumes/[id]/route");
const answersRoute = await import("../answers/route");
const answerRoute = await import("../answers/[id]/route");
const parseResumeRoute = await import("../profile/parse-resume/route");
const { __setTestPipelineOverride } = await import("@/server/pipeline/route-context");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PARSED_RESUME = {
  personal: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "555-0100",
    address: "",
    linkedin: "",
    github: "",
    portfolio: "",
  },
  education: [],
  experience: [],
  skills: ["Python"],
  confidence: { personal: 0.9, education: 0.5, experience: 0.5, skills: 0.8 },
};

async function fakeRunLlm(taskId: string, _input: unknown): Promise<unknown> {
  if (taskId === "resume-parse") return PARSED_RESUME;
  throw new Error(`onboarding-routes.test fakeRunLlm: unexpected task id ${taskId}`);
}

__setTestPipelineOverride({ runLlm: fakeRunLlm });

function post(body?: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function patch(body?: unknown): Request {
  return new Request("http://localhost", { method: "PATCH", body: JSON.stringify(body) });
}

function put(body?: unknown): Request {
  return new Request("http://localhost", { method: "PUT", body: JSON.stringify(body) });
}

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const PDF_BASE64 = Buffer.from("%PDF-1.4 fake resume bytes").toString("base64");

describe("POST /api/v1/resumes", () => {
  it("uploads a PDF resume", async () => {
    const res = await resumesRoute.POST(
      post({ name: "Resume.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.name).toBe("Resume.pdf");
    expect(body.result.isPrimary).toBe(false);
  });

  it("stores and returns extracted résumé text", async () => {
    const res = await resumesRoute.POST(
      post({
        name: "Resume.pdf",
        mimeType: "application/pdf",
        dataBase64: PDF_BASE64,
        text: "Jordan Rivera\nBackend engineer...",
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.text).toBe("Jordan Rivera\nBackend engineer...");
  });

  it("uploads without text with no error", async () => {
    const res = await resumesRoute.POST(
      post({ name: "Resume.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.text).toBe("");
  });

  it("400s a non-PDF mime type", async () => {
    const res = await resumesRoute.POST(
      post({ name: "notes.txt", mimeType: "text/plain", dataBase64: PDF_BASE64 }),
    );
    expect(res.status).toBe(400);
  });

  it("400s a payload over 10 MB decoded", async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString("base64");
    const res = await resumesRoute.POST(
      post({ name: "big.pdf", mimeType: "application/pdf", dataBase64: big }),
    );
    expect(res.status).toBe(400);
  });

  it("400s a malformed body", async () => {
    const res = await resumesRoute.POST(post({ name: "" }));
    expect(res.status).toBe(400);
  });

  it("setting isPrimary true clears the flag on other resumes, then GET lists both", async () => {
    const first = await (
      await resumesRoute.POST(
        post({
          name: "a.pdf",
          mimeType: "application/pdf",
          dataBase64: PDF_BASE64,
          isPrimary: true,
        }),
      )
    ).json();
    const second = await (
      await resumesRoute.POST(
        post({
          name: "b.pdf",
          mimeType: "application/pdf",
          dataBase64: PDF_BASE64,
          isPrimary: true,
        }),
      )
    ).json();

    const list = await (await resumesRoute.GET()).json();
    const a = list.result.find((r: { id: string }) => r.id === first.result.id);
    const b = list.result.find((r: { id: string }) => r.id === second.result.id);
    expect(a.isPrimary).toBe(false);
    expect(b.isPrimary).toBe(true);
  });
});

describe("PATCH /api/v1/resumes/[id]", () => {
  it("sets isPrimary and clears it on other resumes", async () => {
    const a = await (
      await resumesRoute.POST(
        post({ name: "a.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 }),
      )
    ).json();
    const b = await (
      await resumesRoute.POST(
        post({ name: "b.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 }),
      )
    ).json();

    await resumeRoute.PATCH(patch({ isPrimary: true }), idCtx(a.result.id));
    const res = await resumeRoute.PATCH(patch({ isPrimary: true }), idCtx(b.result.id));
    const body = await res.json();
    expect(body.result.isPrimary).toBe(true);

    const list = await (await resumesRoute.GET()).json();
    const aAfter = list.result.find((r: { id: string }) => r.id === a.result.id);
    expect(aAfter.isPrimary).toBe(false);
  });

  it("404s for a missing resume", async () => {
    const res = await resumeRoute.PATCH(patch({ isPrimary: true }), idCtx("does-not-exist"));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/resumes/[id]", () => {
  it("removes a resume", async () => {
    const created = await (
      await resumesRoute.POST(
        post({ name: "a.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 }),
      )
    ).json();
    const res = await resumeRoute.DELETE(post(), idCtx(created.result.id));
    expect(res.status).toBe(200);

    const list = await (await resumesRoute.GET()).json();
    expect(list.result.find((r: { id: string }) => r.id === created.result.id)).toBeUndefined();
  });

  it("404s for a missing resume", async () => {
    const res = await resumeRoute.DELETE(post(), idCtx("does-not-exist"));
    expect(res.status).toBe(404);
  });
});

describe("/api/v1/answers", () => {
  it("creates, lists, updates and deletes an answer", async () => {
    const created = await (
      await answersRoute.POST(
        post({
          questionPatterns: ["Are you legally authorized to work"],
          answer: "Yes",
          type: "boolean",
          category: "eeo",
        }),
      )
    ).json();
    expect(created.success).toBe(true);
    const id: string = created.result.id;

    const list = await (await answersRoute.GET()).json();
    expect(list.result.some((a: { id: string }) => a.id === id)).toBe(true);

    const updated = await (await answerRoute.PUT(put({ answer: "No" }), idCtx(id))).json();
    expect(updated.result.answer).toBe("No");

    const del = await answerRoute.DELETE(post(), idCtx(id));
    expect(del.status).toBe(200);
    const listAfter = await (await answersRoute.GET()).json();
    expect(listAfter.result.some((a: { id: string }) => a.id === id)).toBe(false);
  });

  it("400s a malformed create body", async () => {
    const res = await answersRoute.POST(post({ answer: "Yes" }));
    expect(res.status).toBe(400);
  });

  it("404s a PUT for a missing answer", async () => {
    const res = await answerRoute.PUT(put({ answer: "No" }), idCtx("does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("404s a DELETE for a missing answer", async () => {
    const res = await answerRoute.DELETE(post(), idCtx("does-not-exist"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/profile/parse-resume", () => {
  it("returns the parsed profile from the resume-parse task, with no writes", async () => {
    const res = await parseResumeRoute.POST(post({ resumeText: "Jordan Rivera resume body" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result).toEqual(PARSED_RESUME);
  });

  it("400s an empty resumeText", async () => {
    const res = await parseResumeRoute.POST(post({ resumeText: "" }));
    expect(res.status).toBe(400);
  });
});
