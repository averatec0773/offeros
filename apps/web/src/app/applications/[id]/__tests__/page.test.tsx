// @vitest-environment happy-dom
// Wiring test for the application workspace page: it's a thin passthrough
// that fetches five things by application id and hands them straight to
// <WorkspaceClient> as props — all the real behavior lives in that client
// component (covered by workspace-client.test.tsx). So the seam here is the
// data assembly: mock WorkspaceClient to capture exactly what it was called
// with, and assert each prop came from the right repo/lookup — plus the
// notFound() branch when the id doesn't exist.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";

const dir = mkdtempSync(join(tmpdir(), "offeros-workspace-page-"));
process.env.OFFEROS_DB_PATH = join(dir, "workspace.db");

const workspaceClientSpy = vi.fn((_props: unknown) => <div data-testid="workspace-client-stub" />);
vi.mock("@/components/agent/workspace-client", () => ({
  WorkspaceClient: (props: unknown) => workspaceClientSpy(props),
}));

const { default: ApplicationWorkspace } = await import("../page");
const { getDb } = await import("@/server/db/client");
const { createApplication } = await import("@/server/repositories/application-repo");
const { createPipelineTask } = await import("@/server/repositories/pipeline-task-repo");
const { saveJdAnalysis } = await import("@/server/repositories/jd-analysis-repo");
const { upsertArtifact } = await import("@/server/repositories/artifact-repo");
const { saveFit } = await import("@/server/repositories/fit-repo");

afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  cleanup();
  workspaceClientSpy.mockClear();
});

describe("ApplicationWorkspace page", () => {
  it("throws Next's notFound digest for an unknown application id", async () => {
    await expect(
      ApplicationWorkspace({ params: Promise.resolve({ id: "missing" }) }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("passes the application, task, jd analysis, artifacts and fit for its id to WorkspaceClient", async () => {
    const db = getDb();
    const application = createApplication(db, {
      jobInfo: { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver" },
    });
    // A second, unrelated application makes sure the page filters by id
    // rather than accidentally handing back the whole table.
    createApplication(db, {
      jobInfo: { jobId: "j2", jobTitle: "Other Role", companyName: "Other Co" },
    });

    const task = createPipelineTask(db, { applicationId: application.id });
    const jdAnalysis = saveJdAnalysis(db, {
      id: "jd-1",
      applicationId: application.id,
      summary: "A GenAI role.",
      responsibilities: [],
      requiredSkills: [],
      preferredSkills: [],
      matchNotes: [],
      gaps: [],
      coverLetterRequirement: "unknown",
      createdAt: Date.now(),
    });
    const artifact = upsertArtifact(db, {
      id: "artifact-1",
      taskId: task.id,
      kind: "resume",
      versions: [{ id: "v1", content: "text", rationale: "r", changedLines: [], createdAt: 1 }],
      currentVersionId: "v1",
      createdAt: 1,
      updatedAt: 1,
    });
    const fit = saveFit(db, {
      id: "fit-1",
      applicationId: application.id,
      version: 1,
      overall: 77,
      label: "",
      subScores: { experience: 70, skills: 80, education: 60 },
      whyMatch: "",
      alignedSkills: [],
      notAlignedSkills: [],
      createdAt: Date.now(),
    });

    const element = await ApplicationWorkspace({
      params: Promise.resolve({ id: application.id }),
    });
    render(element);

    expect(workspaceClientSpy).toHaveBeenCalledTimes(1);
    const props = workspaceClientSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect((props.application as { id: string }).id).toBe(application.id);
    expect((props.initialTask as { id: string }).id).toBe(task.id);
    expect((props.initialJdAnalysis as { applicationId: string }).applicationId).toBe(
      jdAnalysis.applicationId,
    );
    expect(props.initialArtifacts).toEqual([artifact]);
    expect((props.initialFit as { id: string }).id).toBe(fit.id);
  });

  it("passes null task/jdAnalysis/fit and an empty artifacts list for an application with no task yet", async () => {
    const db = getDb();
    const application = createApplication(db, {
      jobInfo: { jobId: "j3", jobTitle: "Bare Role", companyName: "Bare Co" },
    });

    const element = await ApplicationWorkspace({
      params: Promise.resolve({ id: application.id }),
    });
    render(element);

    const props = workspaceClientSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(props.initialTask).toBeNull();
    expect(props.initialJdAnalysis).toBeNull();
    expect(props.initialArtifacts).toEqual([]);
    expect(props.initialFit).toBeNull();
  });
});
