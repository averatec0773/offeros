// @vitest-environment happy-dom
// Wiring test for the application detail page: it's a thin passthrough that
// reads everything by application id and hands it straight to
// <ApplicationDetailClient> as props — the real behavior lives in that client
// component (covered by application-detail-client.test.tsx). So the seam here
// is the data assembly: mock the client to capture exactly what it was called
// with, and assert each prop came from the right repo/lookup — plus the
// notFound() branch when the id doesn't exist.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";

const dir = mkdtempSync(join(tmpdir(), "offeros-workspace-page-"));
process.env.OFFEROS_DB_PATH = join(dir, "workspace.db");

const detailClientSpy = vi.fn((_props: unknown) => <div data-testid="detail-client-stub" />);
vi.mock("@/components/agent/application-detail-client", () => ({
  ApplicationDetailClient: (props: unknown) => detailClientSpy(props),
}));

const { default: ApplicationDetailPage } = await import("../page");
const { getDb } = await import("@/server/db/client");
const { createApplication } = await import("@/server/repositories/application-repo");
const { createPipelineTask } = await import("@/server/repositories/pipeline-task-repo");
const { upsertArtifact } = await import("@/server/repositories/artifact-repo");
const { saveFit } = await import("@/server/repositories/fit-repo");

afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => {
  cleanup();
  detailClientSpy.mockClear();
});

describe("Application detail page", () => {
  it("throws Next's notFound digest for an unknown application id", async () => {
    await expect(
      ApplicationDetailPage({ params: Promise.resolve({ id: "missing" }) }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("passes the application, task, artifacts, fit and requirements for its id", async () => {
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

    const element = await ApplicationDetailPage({
      params: Promise.resolve({ id: application.id }),
    });
    render(element);

    expect(detailClientSpy).toHaveBeenCalledTimes(1);
    const props = detailClientSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect((props.application as { id: string }).id).toBe(application.id);
    expect((props.initialTask as { id: string }).id).toBe(task.id);
    expect(props.initialArtifacts).toEqual([artifact]);
    expect((props.initialFit as { id: string }).id).toBe(fit.id);
    // The requirements summary is assembled server-side, so the card is
    // complete on first paint rather than flashing an empty state.
    expect((props.initialRequirements as { source: string }).source).toBe("none");
    expect(props.initialEvents).toEqual([]);
  });

  it("passes a null task and empty lists for an application with nothing on it yet", async () => {
    const db = getDb();
    const application = createApplication(db, {
      jobInfo: { jobId: "j3", jobTitle: "Bare Role", companyName: "Bare Co" },
    });

    const element = await ApplicationDetailPage({
      params: Promise.resolve({ id: application.id }),
    });
    render(element);

    const props = detailClientSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(props.initialTask).toBeNull();
    expect(props.initialArtifacts).toEqual([]);
    expect(props.initialFit).toBeNull();
    expect(props.initialIncidents).toEqual([]);
  });
});
