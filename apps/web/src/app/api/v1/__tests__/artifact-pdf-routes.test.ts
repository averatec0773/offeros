import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact } from "@offeros/core";
import type { RenderResult } from "@/server/export/renderers";

const dir = mkdtempSync(join(tmpdir(), "offeros-pdf-route-"));
process.env.OFFEROS_DB_PATH = join(dir, "route.db");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const exportMock = vi.fn<(...args: unknown[]) => Promise<RenderResult>>();
vi.mock("@/server/services/export-service", () => ({
  exportArtifactPdf: (...args: unknown[]) => exportMock(...args),
}));

const { getDb } = await import("@/server/db/client");
const { createApplication } = await import("@/server/repositories/application-repo");
const { createPipelineTask } = await import("@/server/repositories/pipeline-task-repo");
const { upsertArtifact } = await import("@/server/repositories/artifact-repo");
const { GET } = await import("../agent/tasks/[id]/artifacts/[kind]/pdf/route");
const { PATCH } = await import("../agent/tasks/[id]/artifacts/[kind]/route");

const PDF = Buffer.from("%PDF-1.4 route test\n%%EOF\n");

/** 2026-08-12, so the date inside a document's name is fixed. */
const AUG_12 = Date.UTC(2026, 7, 12, 6, 30);

function artifact(taskId: string, kind: Artifact["kind"]): Artifact {
  const now = AUG_12;
  return {
    id: `${taskId}-${kind}`,
    taskId,
    kind,
    versions: [{ id: "v1", content: "content", rationale: "", createdAt: now }],
    currentVersionId: "v1",
    createdAt: now,
    updatedAt: now,
  };
}

function seed(company = "Evolver AI", title = "GenAI Engineer"): string {
  const db = getDb();
  const app = createApplication(db, {
    jobInfo: { jobId: `j-${Math.random()}`, jobTitle: title, companyName: company },
  });
  const task = createPipelineTask(db, { applicationId: app.id });
  upsertArtifact(db, artifact(task.id, "cover-letter"));
  return task.id;
}

const ctx = (id: string, kind: string) => ({ params: Promise.resolve({ id, kind }) });
const req = () => new Request("http://localhost");

beforeEach(() => exportMock.mockReset());

describe("GET artifact pdf route", () => {
  it("streams pdf bytes with content-type and a sensible filename", async () => {
    const taskId = seed("Evolver AI", "GenAI Engineer");
    exportMock.mockResolvedValue({ ok: true, pdf: PDF });

    const res = await GET(req(), ctx(taskId, "cover-letter"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    // The file is named what the document is called — the derived default
    // here, since this artifact was stored without a name.
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain('filename="cover_EvolverAI_2026-08-12.pdf"');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("surfaces a builtin-fallback note via x-offeros-render-note (absent otherwise)", async () => {
    const taskId = seed();
    exportMock.mockResolvedValueOnce({ ok: true, pdf: PDF, note: "fell back to builtin" });
    const withNote = await GET(req(), ctx(taskId, "cover-letter"));
    expect(withNote.headers.get("x-offeros-render-note")).toBe("fell back to builtin");

    exportMock.mockResolvedValueOnce({ ok: true, pdf: PDF });
    const noNote = await GET(req(), ctx(taskId, "cover-letter"));
    expect(noNote.headers.get("x-offeros-render-note")).toBeNull();
  });

  it("404s an unknown task", async () => {
    const res = await GET(req(), ctx("nope", "cover-letter"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(exportMock).not.toHaveBeenCalled();
  });

  it("404s when the artifact is missing", async () => {
    const db = getDb();
    const app = createApplication(db, {
      jobInfo: { jobId: `j-${Math.random()}`, jobTitle: "X", companyName: "Y" },
    });
    const task = createPipelineTask(db, { applicationId: app.id });
    const res = await GET(req(), ctx(task.id, "cover-letter"));
    expect(res.status).toBe(404);
    expect(exportMock).not.toHaveBeenCalled();
  });

  it("400s an unknown kind before touching the service", async () => {
    const taskId = seed();
    const res = await GET(req(), ctx(taskId, "transcript"));
    expect(res.status).toBe(400);
    expect(exportMock).not.toHaveBeenCalled();
  });

  it("400s with logExcerpt folded into errorMsg on a render failure", async () => {
    const taskId = seed();
    exportMock.mockResolvedValue({
      ok: false,
      error: "pdflatex exited with code 1",
      logExcerpt: "! Undefined control sequence.",
    });
    const res = await GET(req(), ctx(taskId, "cover-letter"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.errorMsg).toContain("pdflatex exited with code 1");
    expect(body.errorMsg).toContain("Undefined control sequence");
  });
});

describe("PATCH artifact route (rename)", () => {
  const body = (name: unknown) =>
    new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ name }) });

  it("renames the document, and the download follows the new name", async () => {
    const taskId = seed("Evolver AI");
    const renamed = await PATCH(body("  the one that worked  "), ctx(taskId, "cover-letter"));
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).result).toEqual({ name: "the one that worked" });

    exportMock.mockResolvedValue({ ok: true, pdf: PDF });
    const download = await GET(req(), ctx(taskId, "cover-letter"));
    const disposition = download.headers.get("content-disposition") ?? "";
    expect(disposition).toContain('filename="the one that worked.pdf"');
  });

  it("keeps a non-ASCII name intact in the download header", async () => {
    // The ASCII fallback plus the RFC 5987 form — a name in Chinese must not
    // arrive as "download" or as mojibake.
    const taskId = seed("字节跳动");
    await PATCH(body("字节跳动_求职信"), ctx(taskId, "cover-letter"));
    exportMock.mockResolvedValue({ ok: true, pdf: PDF });
    const download = await GET(req(), ctx(taskId, "cover-letter"));
    const disposition = download.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]!)).toBe(
      "字节跳动_求职信.pdf",
    );
  });

  it("400s an empty name, a too-long name, and an unknown kind", async () => {
    const taskId = seed();
    expect((await PATCH(body("   "), ctx(taskId, "cover-letter"))).status).toBe(400);
    expect((await PATCH(body("x".repeat(200)), ctx(taskId, "cover-letter"))).status).toBe(400);
    expect((await PATCH(body("fine"), ctx(taskId, "transcript"))).status).toBe(400);
  });

  it("404s a document that does not exist", async () => {
    const taskId = seed();
    // The task exists; a résumé for it does not.
    expect((await PATCH(body("fine"), ctx(taskId, "resume"))).status).toBe(404);
  });
});
