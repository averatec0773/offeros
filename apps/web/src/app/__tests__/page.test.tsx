// @vitest-environment happy-dom
// Wiring test for the homepage server component: it calls four repos
// directly (applications, tasks, profile, fits) and hand-assembles the
// active/finished split + per-row task/fit lookups before handing rows to
// <ApplicationList>. The page itself does the data assembly, so this renders
// the real component tree and asserts on output that only appears if each
// repo's data actually made it through (task step, fit percentage,
// profile-gated CTA). The one thing stubbed is next/navigation's router —
// the list is a client component that holds a router handle for post-assign
// refreshes, and no app router is mounted outside Next itself.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";

const dir = mkdtempSync(join(tmpdir(), "offeros-home-page-"));
process.env.OFFEROS_DB_PATH = join(dir, "home.db");

const { default: HomePage } = await import("../page");
const { getDb } = await import("@/server/db/client");
const { createApplication } = await import("@/server/repositories/application-repo");
const { createAgentTask, updateAgentTask } = await import("@/server/repositories/agent-task-repo");
const { saveFit } = await import("@/server/repositories/fit-repo");
const { saveProfile } = await import("@/server/repositories/profile-repo");

afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(cleanup);

const PROFILE = {
  personal: { name: "Jordan Rivera", email: "j@example.com", phone: "555", links: {} },
  skills: ["Python"],
  education: [],
  experience: [],
};

// Tests run in this order (not parallel) because they share one on-disk DB
// and build on each other's state — the empty-state assertions must run
// before any application exists.
describe("HomePage", () => {
  it("shows the profile setup CTA only when there are no applications and no profile yet", () => {
    render(HomePage());
    expect(screen.getByText("No applications yet")).toBeTruthy();
    expect(screen.getByText("Set up your profile first")).toBeTruthy();
  });

  it("hides the profile setup CTA once a profile has been saved", () => {
    saveProfile(getDb(), PROFILE);
    render(HomePage());
    expect(screen.getByText("No applications yet")).toBeTruthy();
    expect(screen.queryByText("Set up your profile first")).toBeNull();
  });

  it("splits applications into in-progress/finished and gives each row its own tracking + fit", () => {
    const db = getDb();
    const active = createApplication(db, {
      jobInfo: { jobId: "j1", jobTitle: "GenAI Engineer", companyName: "Evolver" },
      status: "saved",
    });
    const finished = createApplication(db, {
      jobInfo: { jobId: "j2", jobTitle: "Platform Engineer", companyName: "Nimbus" },
      status: "rejected",
    });
    const task = createAgentTask(db, { applicationId: active.id });
    updateAgentTask(db, task.id, { step: 3 });
    saveFit(db, {
      id: "fit-1",
      applicationId: active.id,
      version: 1,
      overall: 82,
      label: "",
      subScores: { experience: 80, skills: 90, education: 70 },
      whyMatch: "",
      alignedSkills: [],
      notAlignedSkills: [],
      createdAt: Date.now(),
    });
    void finished;

    render(HomePage());

    expect(screen.getByText("2 total · 1 active")).toBeTruthy();

    const inProgress = screen.getByText("In progress").closest("section")!;
    expect(inProgress.textContent).toContain("GenAI Engineer");
    // The row reports what the fill did, not the pipeline step it reached.
    expect(inProgress.textContent).toContain("Not started");
    expect(inProgress.querySelector('[data-testid="fit-badge"]')?.textContent).toBe("82%");

    const finishedSection = screen.getByText("Finished").closest("section")!;
    expect(finishedSection.textContent).toContain("Platform Engineer");
    // The finished application never got a task or a fit — its row must not
    // pick up the active application's data.
    expect(finishedSection.textContent).toContain("Not started");
    expect(finishedSection.querySelector('[data-testid="fit-badge"]')).toBeNull();
  });
});
