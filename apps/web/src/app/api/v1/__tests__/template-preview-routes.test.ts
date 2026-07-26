import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BODY_START, BODY_END } from "@offeros/core";
import type { Renderer } from "@/server/export/renderers";

// The render-failure test swaps RENDERERS.latex for a mock, but the service
// short-circuits on hasPdflatex() before reaching the registry — so on a
// machine without pdflatex (CI) the mock is never called. Pin the probe to
// true; every latex render in this file goes through the mocked registry.
vi.mock("@/server/export/latex-renderer", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/export/latex-renderer")>();
  return { ...mod, hasPdflatex: () => true };
});

const dir = mkdtempSync(join(tmpdir(), "offeros-template-preview-route-"));
process.env.OFFEROS_DB_PATH = join(dir, "preview-route.db");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const { getDb } = await import("@/server/db/client");
const { saveTemplate, listTemplates, deleteTemplate } =
  await import("@/server/services/template-service");
const { RENDERERS } = await import("@/server/export/renderers");
const analyzeRoute = await import("../templates/analyze/route");
const previewRoute = await import("../templates/preview/route");

const original = { latex: RENDERERS.latex, builtin: RENDERERS.builtin };
const fakePdf = Buffer.from("%PDF-1.4 fake\n%%EOF\n");
let latexSpy: ReturnType<typeof vi.fn<Renderer>>;
let builtinSpy: ReturnType<typeof vi.fn<Renderer>>;

beforeEach(() => {
  for (const t of listTemplates(getDb())) deleteTemplate(getDb(), t.id);
  latexSpy = vi.fn<Renderer>(async () => ({ ok: true as const, pdf: fakePdf }));
  builtinSpy = vi.fn<Renderer>(async () => ({ ok: true as const, pdf: fakePdf }));
  RENDERERS.latex = latexSpy;
  RENDERERS.builtin = builtinSpy;
});
afterEach(() => {
  RENDERERS.latex = original.latex;
  RENDERERS.builtin = original.builtin;
});

const TEX = [
  "\\documentclass{article}",
  "\\begin{document}",
  "Dear Team,",
  BODY_START,
  "body",
  BODY_END,
  "Sincerely,",
  "\\end{document}",
].join("\n");

type Env<T> = { success: boolean; errorCode: number; errorMsg: string | null; result: T | null };
async function body<T>(res: Response): Promise<Env<T>> {
  return (await res.json()) as Env<T>;
}
function post(payload?: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

describe("POST /templates/analyze", () => {
  it("returns the analyze result for a well-formed template", async () => {
    const res = await analyzeRoute.POST(post({ content: TEX }));
    expect(res.status).toBe(200);
    const b = await body<{ detected: boolean; contentWithMarkers: string }>(res);
    expect(b.success).toBe(true);
    expect(b.result!.detected).toBe(true);
    expect(b.result!.contentWithMarkers).toContain(BODY_START);
  });

  it("400s on empty content", async () => {
    const res = await analyzeRoute.POST(post({ content: "" }));
    expect(res.status).toBe(400);
    const b = await body(res);
    expect(b.success).toBe(false);
  });

  it("400s on whitespace-only content", async () => {
    const res = await analyzeRoute.POST(post({ content: "   \n  " }));
    expect(res.status).toBe(400);
  });
});

describe("POST /templates/preview", () => {
  it("streams a PDF for an inline builtin template", async () => {
    const res = await previewRoute.POST(post({ content: "hello", renderer: "builtin" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("Template_Preview.pdf");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(builtinSpy).toHaveBeenCalledTimes(1);
  });

  it("streams a PDF for a saved template referenced by id", async () => {
    const saved = saveTemplate(getDb(), {
      name: "cl",
      kind: "cover-letter",
      renderer: "builtin",
      content: "hello",
      isDefault: false,
    });
    const res = await previewRoute.POST(post({ id: saved.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(builtinSpy).toHaveBeenCalledTimes(1);
  });

  it("400s with an enveloped error (logExcerpt folded in) on a render failure", async () => {
    RENDERERS.latex = vi.fn<Renderer>(async () => ({
      ok: false,
      error: "pdflatex exited with code 1",
      logExcerpt: "! Undefined control sequence.",
    }));
    const res = await previewRoute.POST(post({ content: TEX, renderer: "latex" }));
    expect(res.status).toBe(400);
    const b = await body(res);
    expect(b.success).toBe(false);
    expect(b.errorMsg).toContain("pdflatex exited with code 1");
    expect(b.errorMsg).toContain("Undefined control sequence");
  });

  it("handles an unknown id without throwing", async () => {
    const res = await previewRoute.POST(post({ id: "nope" }));
    expect(res.status).toBe(400);
    const b = await body(res);
    expect(b.success).toBe(false);
  });

  it("400s when neither content+renderer nor id is provided", async () => {
    const res = await previewRoute.POST(post({}));
    expect(res.status).toBe(400);
  });

  it("400s when both content and id are provided (ambiguous)", async () => {
    const res = await previewRoute.POST(post({ content: "hello", renderer: "builtin", id: "x" }));
    expect(res.status).toBe(400);
  });

  it("400s on an inline renderer outside the template allowlist (e.g. the internal 'resume' renderer)", async () => {
    const res = await previewRoute.POST(post({ content: "hello", renderer: "resume" }));
    expect(res.status).toBe(400);
    const b = await body(res);
    expect(b.success).toBe(false);
  });
});
