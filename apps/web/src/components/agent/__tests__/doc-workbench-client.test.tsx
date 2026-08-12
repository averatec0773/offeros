// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Application, ApplicationEvent, Artifact } from "@offeros/core";
import { DocWorkbenchClient } from "../doc-workbench-client";
import { api } from "@/lib/api-client";

/**
 * The workbench is where a document is actually worked on, so what these hold
 * is that every one of its actions reaches the real endpoint — above all
 * Accept, which is the only way style memory ever learns from a revision.
 */

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      pipelineTasks: {
        get: vi.fn(),
        tailor: vi.fn(),
        coverLetter: vi.fn(),
        approveArtifact: vi.fn(),
        tweak: vi.fn(),
      },
      applications: { ensureTask: vi.fn() },
      artifacts: actual.api.artifacts,
    },
  };
});

afterEach(cleanup);

const application: Application = {
  id: "app-1",
  jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
  status: "applying",
  createdAt: 1,
  updatedAt: 1,
};

const artifact: Artifact = {
  id: "a1",
  taskId: "t1",
  kind: "resume",
  versions: [
    { id: "v1", content: "First pass body", rationale: "Led with the ML work", createdAt: 100 },
    {
      id: "v2",
      content: "Shorter body",
      rationale: "Trimmed to one page",
      instruction: "make it shorter",
      createdAt: 300,
    },
  ],
  currentVersionId: "v2",
  createdAt: 1,
  updatedAt: 1,
};

const approved: ApplicationEvent = {
  id: "e1",
  applicationId: "app-1",
  kind: "artifact-approved",
  at: 400,
  payload: { kind: "resume" },
};

function mount(over: Partial<Parameters<typeof DocWorkbenchClient>[0]> = {}) {
  const props = {
    application,
    kind: "resume" as const,
    taskId: "t1" as string | null,
    initialArtifact: artifact as Artifact | null,
    events: [] as ApplicationEvent[],
    ...over,
  };
  render(<DocWorkbenchClient {...props} />);
  return props;
}

beforeEach(() => {
  vi.mocked(api.pipelineTasks.get).mockResolvedValue({
    task: null as never,
    jdAnalysis: null,
    artifacts: [artifact],
  });
  vi.mocked(api.pipelineTasks.tailor).mockResolvedValue(null as never);
  vi.mocked(api.pipelineTasks.approveArtifact).mockResolvedValue({
    approved: true,
    kind: "resume",
  });
  vi.mocked(api.applications.ensureTask).mockResolvedValue({
    taskId: "t1",
    task: null as never,
    artifacts: [],
  });
});

describe("nothing generated yet", () => {
  it("is an empty state with one marked button", () => {
    mount({ initialArtifact: null });
    expect(screen.getByText("Nothing here yet")).toBeTruthy();
    const generate = screen.getByRole("button", { name: /Generate/ });
    expect(generate.getAttribute("title")).toMatch(/your own API key/i);
  });

  it("creates the task on demand, so the user never meets one", async () => {
    mount({ initialArtifact: null, taskId: null });
    fireEvent.click(screen.getByRole("button", { name: /Generate/ }));
    await waitFor(() => expect(api.applications.ensureTask).toHaveBeenCalledWith("app-1"));
    await waitFor(() => expect(api.pipelineTasks.tailor).toHaveBeenCalledWith("t1"));
  });
});

describe("a draft", () => {
  it("shows the document, its state and its version", () => {
    mount();
    expect(screen.getByText("Shorter body")).toBeTruthy();
    expect(screen.getByText(/Draft · v2/)).toBeTruthy();
  });

  it("shows why this version exists, and what was asked for", () => {
    mount();
    expect(screen.getByText("Trimmed to one page")).toBeTruthy();
    // The instruction that produced it, not the placeholder that suggests one.
    expect(screen.getByText(/Asked for: .*make it shorter/)).toBeTruthy();
  });

  it("Accept reaches the approve endpoint — the style-memory learning path", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
    await waitFor(() =>
      expect(api.pipelineTasks.approveArtifact).toHaveBeenCalledWith("t1", "resume"),
    );
  });

  it("says so when the document has been accepted", () => {
    mount({ events: [approved] });
    expect(screen.getByText(/Accepted · v2/)).toBeTruthy();
  });

  it("the header flips to Accepted right after clicking Accept, before any reload", async () => {
    // The events prop is the server snapshot from render time — an accept made
    // on this page is not in it. The header must not keep saying Draft.
    mount({ events: [] });
    expect(screen.getByText(/Draft · v2/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
    await waitFor(() => expect(screen.getByText(/Accepted · v2/)).toBeTruthy());
  });
});

describe("history", () => {
  it("lists every version, newest first, and opens an older one read-only", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /v1 · first pass/ }));
    expect(screen.getByText("First pass body")).toBeTruthy();
    expect(screen.getByText(/Viewing v1 — an older version/)).toBeTruthy();
  });

  it("is honest that older versions cannot be restored", () => {
    // There is no rollback endpoint; inventing one here would put a second
    // writer on the artifact that the generation path knows nothing about.
    mount();
    expect(screen.getByText(/readable, not restorable/i)).toBeTruthy();
  });
});

describe("getting between the two documents", () => {
  it("offers the other one, at the same route with the other kind", () => {
    mount();
    const links = screen.getAllByRole("link", { name: /Cover letter/i });
    expect(
      links.some((l) => l.getAttribute("href") === "/applications/app-1/doc/cover-letter"),
    ).toBe(true);
  });

  it("goes back to the application it belongs to", () => {
    mount();
    expect(screen.getByRole("link", { name: /Acme · ML Engineer/ }).getAttribute("href")).toBe(
      "/applications/app-1",
    );
  });

  it("renders a cover letter as text rather than a résumé structure", () => {
    mount({
      kind: "cover-letter",
      initialArtifact: {
        ...artifact,
        kind: "cover-letter",
        versions: [{ id: "c1", content: "Dear hiring team,", rationale: "", createdAt: 1 }],
        currentVersionId: "c1",
      },
    });
    expect(screen.getByText("Dear hiring team,")).toBeTruthy();
  });
});
