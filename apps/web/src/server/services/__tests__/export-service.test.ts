import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact, ArtifactVersion, Profile, StructuredResume } from "@offeros/core";
import { BODY_START, BODY_END } from "@offeros/core";
import type { Renderer } from "@/server/export/renderers";

const dir = mkdtempSync(join(tmpdir(), "offeros-export-svc-"));
process.env.OFFEROS_DB_PATH = join(dir, "export.db");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const { getDb } = await import("@/server/db/client");
const { createApplication } = await import("@/server/repositories/application-repo");
const { createAgentTask } = await import("@/server/repositories/agent-task-repo");
const { upsertArtifact } = await import("@/server/repositories/artifact-repo");
const profileRepo = await import("@/server/repositories/profile-repo");
const { saveProfile } = profileRepo;
const { saveTemplate, listTemplates, deleteTemplate } =
  await import("@/server/services/template-service");
const { RENDERERS } = await import("@/server/export/renderers");
const { hasPdflatex } = await import("@/server/export/latex-renderer");
const { exportArtifactPdf } = await import("@/server/services/export-service");

const original = { latex: RENDERERS.latex, builtin: RENDERERS.builtin, resume: RENDERERS.resume };
const fakePdf = Buffer.from("%PDF-1.4 fake\n");
let latexSpy: ReturnType<typeof vi.fn<Renderer>>;
let builtinSpy: ReturnType<typeof vi.fn<Renderer>>;
let resumeSpy: ReturnType<typeof vi.fn<Renderer>>;

beforeEach(() => {
  for (const t of listTemplates(getDb())) deleteTemplate(getDb(), t.id);
  latexSpy = vi.fn<Renderer>(async () => ({ ok: true as const, pdf: fakePdf }));
  builtinSpy = vi.fn<Renderer>(async () => ({ ok: true as const, pdf: fakePdf }));
  resumeSpy = vi.fn<Renderer>(async () => ({ ok: true as const, pdf: fakePdf }));
  RENDERERS.latex = latexSpy;
  RENDERERS.builtin = builtinSpy;
  RENDERERS.resume = resumeSpy;
});
afterEach(() => {
  RENDERERS.latex = original.latex;
  RENDERERS.builtin = original.builtin;
  RENDERERS.resume = original.resume;
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

function artifact(
  taskId: string,
  kind: Artifact["kind"],
  content: string,
  resumeData?: ArtifactVersion["resumeData"],
): Artifact {
  const now = Date.now();
  return {
    id: `${taskId}-${kind}`,
    taskId,
    kind,
    versions: [{ id: "v1", content, rationale: "", createdAt: now, resumeData }],
    currentVersionId: "v1",
    createdAt: now,
    updatedAt: now,
  };
}

const RESUME_DATA: StructuredResume = {
  summary: "Backend engineer.",
  experience: [],
  education: [],
  skills: ["TypeScript"],
};

const PROFILE: Profile = {
  personal: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "555-0101",
    city: "Austin",
    state: "TX",
    country: "USA",
    links: {},
  },
  skills: [],
  education: [],
  experience: [],
};

function seed(): string {
  const db = getDb();
  const app = createApplication(db, {
    jobInfo: { jobId: `j-${Math.random()}`, jobTitle: "GenAI Engineer", companyName: "Evolver" },
  });
  const task = createAgentTask(db, { applicationId: app.id });
  upsertArtifact(db, artifact(task.id, "resume", "Resume text body."));
  upsertArtifact(db, artifact(task.id, "cover-letter", "Cover letter text body."));
  return task.id;
}

describe("exportArtifactPdf", () => {
  it("routes resume to the builtin renderer with job meta", async () => {
    const taskId = seed();
    const result = await exportArtifactPdf(getDb(), taskId, "resume");
    expect(result.ok).toBe(true);
    expect(builtinSpy).toHaveBeenCalledTimes(1);
    expect(latexSpy).not.toHaveBeenCalled();
    const passed = builtinSpy.mock.calls[0]![0];
    expect(passed.meta).toEqual({
      title: "Resume",
      jobTitle: "GenAI Engineer",
      company: "Evolver",
    });
  });

  it("routes cover-letter with a default latex template to latex (when pdflatex present)", async () => {
    const taskId = seed();
    saveTemplate(getDb(), {
      name: "cl",
      kind: "cover-letter",
      renderer: "latex",
      content: TEX,
      isDefault: true,
    });
    const result = await exportArtifactPdf(getDb(), taskId, "cover-letter");
    expect(result.ok).toBe(true);
    if (hasPdflatex()) {
      expect(latexSpy).toHaveBeenCalledTimes(1);
      expect(latexSpy.mock.calls[0]![0].template!.renderer).toBe("latex");
    } else {
      expect(builtinSpy).toHaveBeenCalledTimes(1);
      if (result.ok) expect(result.note).toBeTruthy();
    }
  });

  it("falls back to builtin with a note when there is no latex template", async () => {
    const taskId = seed();
    const result = await exportArtifactPdf(getDb(), taskId, "cover-letter");
    expect(result.ok).toBe(true);
    expect(builtinSpy).toHaveBeenCalledTimes(1);
    expect(latexSpy).not.toHaveBeenCalled();
    if (result.ok) expect(result.note).toBeTruthy();
  });

  it("returns ok:false when the artifact is missing", async () => {
    const db = getDb();
    const app = createApplication(db, {
      jobInfo: { jobId: `j-${Math.random()}`, jobTitle: "X", companyName: "Y" },
    });
    const task = createAgentTask(db, { applicationId: app.id });
    const result = await exportArtifactPdf(db, task.id, "resume");
    expect(result.ok).toBe(false);
  });

  // Mocks getProfile to return null regardless of run order, rather than
  // relying on this test executing before any other test in the file saves
  // a profile (the profile row is a DB-wide singleton).
  it("falls back to the builtin renderer when resumeData is present but there is no profile", async () => {
    const getProfileSpy = vi.spyOn(profileRepo, "getProfile").mockReturnValue(null);
    try {
      const db = getDb();
      const app = createApplication(db, {
        jobInfo: {
          jobId: `j-${Math.random()}`,
          jobTitle: "GenAI Engineer",
          companyName: "Evolver",
        },
      });
      const task = createAgentTask(db, { applicationId: app.id });
      upsertArtifact(db, artifact(task.id, "resume", "Resume text body.", RESUME_DATA));

      const result = await exportArtifactPdf(db, task.id, "resume");
      expect(result.ok).toBe(true);
      expect(builtinSpy).toHaveBeenCalledTimes(1);
      expect(resumeSpy).not.toHaveBeenCalled();
    } finally {
      getProfileSpy.mockRestore();
    }
  });

  it("routes resume to the résumé renderer with structured data + profile header when resumeData is present", async () => {
    const db = getDb();
    saveProfile(db, PROFILE);
    const app = createApplication(db, {
      jobInfo: { jobId: `j-${Math.random()}`, jobTitle: "GenAI Engineer", companyName: "Evolver" },
    });
    const task = createAgentTask(db, { applicationId: app.id });
    upsertArtifact(db, artifact(task.id, "resume", "Resume text body.", RESUME_DATA));

    const result = await exportArtifactPdf(db, task.id, "resume");
    expect(result.ok).toBe(true);
    expect(resumeSpy).toHaveBeenCalledTimes(1);
    expect(builtinSpy).not.toHaveBeenCalled();
    const passed = resumeSpy.mock.calls[0]![0];
    expect(passed.resume?.data).toEqual(RESUME_DATA);
    expect(passed.resume?.header.name).toBe("Jordan Rivera");
  });

  it("falls back to the builtin renderer when resumeData is absent (old artifact)", async () => {
    const taskId = seed();
    const result = await exportArtifactPdf(getDb(), taskId, "resume");
    expect(result.ok).toBe(true);
    expect(builtinSpy).toHaveBeenCalledTimes(1);
    expect(resumeSpy).not.toHaveBeenCalled();
  });
});
