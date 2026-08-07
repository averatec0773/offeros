// @vitest-environment happy-dom
// Wiring test for the /workspace nav entry: with nothing to open it renders
// the empty state; otherwise it redirects into the most recent active
// application's workspace (active preferred over finished regardless of age).
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";

const dir = mkdtempSync(join(tmpdir(), "offeros-workspace-page-"));
process.env.OFFEROS_DB_PATH = join(dir, "workspace.db");

const { default: WorkspacePage } = await import("../page");
const { getDb } = await import("@/server/db/client");
const { createApplication } = await import("@/server/repositories/application-repo");

afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(cleanup);

// Shared on-disk DB — the empty-state test must run before any application exists.
describe("WorkspacePage", () => {
  it("renders the empty state with a create CTA when no applications exist", () => {
    render(WorkspacePage());
    expect(screen.getByText("No agent workspace yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: /New application/ })).toBeTruthy();
  });

  it("redirects into the active application's workspace, preferring active over newer finished ones", () => {
    const db = getDb();
    const active = createApplication(db, {
      jobInfo: { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver" },
      status: "saved",
    });
    createApplication(db, {
      jobInfo: { jobId: "j2", jobTitle: "Platform Engineer", companyName: "Nimbus" },
      status: "rejected",
    });
    let thrown: unknown;
    try {
      WorkspacePage();
    } catch (e) {
      thrown = e;
    }
    // next's redirect() throws; the digest carries the target path.
    expect(String((thrown as { digest?: string })?.digest)).toContain(`/applications/${active.id}`);
  });
});
