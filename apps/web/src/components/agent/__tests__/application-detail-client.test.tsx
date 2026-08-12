// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PIPELINE_STEPS, type PipelineTask, type Application, type Artifact } from "@offeros/core";
import type { RequirementsSummary } from "@/server/services/requirements-service";
import { ApplicationDetailClient, effectiveResumeId } from "../application-detail-client";
import { api } from "@/lib/api-client";

/**
 * The application page is a record, not a workbench. What these tests hold in
 * place is that the record's few real actions still reach the services behind
 * them — above all "Accept", which is the only way style memory ever learns
 * anything from a revision.
 */

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      pipelineTasks: {
        get: vi.fn(),
        tailor: vi.fn(),
        coverLetter: vi.fn(),
        approveArtifact: vi.fn(),
        tweak: vi.fn(),
        fillHandoff: vi.fn(),
        fillResolve: vi.fn(),
      },
      applications: {
        get: vi.fn(),
        update: vi.fn(),
        events: vi.fn(),
        requirements: vi.fn(),
        recon: vi.fn(),
        ensureTask: vi.fn(),
        analyzeJd: vi.fn(),
      },
      resumes: { list: vi.fn() },
      fit: { recompute: vi.fn() },
    },
  };
});

afterEach(cleanup);

const application: Application = {
  id: "app-1",
  jobInfo: {
    jobId: "j1",
    jobTitle: "ML Engineer",
    companyName: "Acme",
    applyLink: "https://ats.example/apply",
  },
  status: "applying",
  createdAt: 1,
  updatedAt: 1,
};

const FILL_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "fill-form");

const task = (over: Partial<PipelineTask> = {}): PipelineTask => ({
  id: "t1",
  applicationId: "app-1",
  status: "awaiting_user",
  coverLetterRequirement: "unknown",
  skippedCoverLetter: false,
  step: FILL_STEP,
  fieldReports: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

const resumeArtifact: Artifact = {
  id: "a1",
  taskId: "t1",
  kind: "resume",
  versions: [
    { id: "v1", content: "Jordan Rivera\nSUMMARY", rationale: "first pass", createdAt: 1 },
  ],
  currentVersionId: "v1",
  createdAt: 1,
  updatedAt: 1,
};

const requirements = (over: Partial<RequirementsSummary> = {}): RequirementsSummary => ({
  source: "none",
  total: 0,
  required: 0,
  ready: 0,
  missing: [],
  freeText: 0,
  needsCoverLetter: false,
  ...over,
});

type Props = Parameters<typeof ApplicationDetailClient>[0];

function mount(over: Partial<Props> = {}) {
  const props: Props = {
    application,
    initialTask: null,
    initialArtifacts: [],
    initialFit: null,
    initialEvents: [],
    initialRequirements: requirements(),
    initialIncidents: [],
    initialJdAnalysis: null,
    profileSkills: [],
    ...over,
  };
  return render(<ApplicationDetailClient {...props} />);
}

beforeEach(() => {
  vi.mocked(api.resumes.list).mockResolvedValue([]);
  vi.mocked(api.applications.events).mockResolvedValue([]);
  vi.mocked(api.applications.requirements).mockResolvedValue(requirements());
  vi.mocked(api.applications.update).mockResolvedValue(application);
  vi.mocked(api.applications.get).mockResolvedValue(application);
  vi.mocked(api.applications.ensureTask).mockResolvedValue({
    taskId: "t1",
    task: task(),
    artifacts: [],
  });
  vi.mocked(api.pipelineTasks.get).mockResolvedValue({
    task: task(),
    jdAnalysis: null,
    artifacts: [],
  });
  vi.mocked(api.pipelineTasks.tailor).mockResolvedValue(task());
  vi.mocked(api.pipelineTasks.approveArtifact).mockResolvedValue({
    approved: true,
    kind: "resume",
  });
  vi.mocked(api.pipelineTasks.fillHandoff).mockResolvedValue({
    id: "h1",
    taskId: "t1",
    applicationId: "app-1",
    applyLink: "https://ats.example/apply",
    status: "pending",
    createdAt: 1,
    updatedAt: 1,
  });
  vi.spyOn(window, "open").mockImplementation(() => null);
});

describe("the header", () => {
  it("shows the job, the link, and the status the user controls", () => {
    mount();
    expect(screen.getByRole("heading", { name: "ML Engineer" })).toBeTruthy();
    expect(screen.getByText(/Acme/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Original posting/i })).toBeTruthy();
    expect((screen.getByLabelText("Status") as HTMLSelectElement).value).toBe("applying");
  });

  it("sends Ask to the agent page carrying this application", () => {
    mount();
    expect(screen.getByRole("link", { name: /Ask agent/i }).getAttribute("href")).toBe(
      "/agent?application=app-1",
    );
  });

  it("writes a status the user picked straight through", async () => {
    mount();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "interview" } });
    await waitFor(() =>
      expect(api.applications.update).toHaveBeenCalledWith("app-1", { status: "interview" }),
    );
  });

  it("has no pipeline machinery left: no Start, no step timeline, no gates", () => {
    mount({ initialTask: task() });
    expect(screen.queryByRole("button", { name: /^Start$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Pause$/i })).toBeNull();
    expect(screen.queryByText(/Standby/i)).toBeNull();
  });
});

describe("checking the posting", () => {
  it("runs reconnaissance and re-reads what it found", async () => {
    vi.mocked(api.applications.recon).mockResolvedValue({
      verdict: "open",
      detail: "The posting is still up.",
      at: 1,
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Check job/i }));
    await waitFor(() => expect(api.applications.recon).toHaveBeenCalledWith("app-1"));
    await waitFor(() => expect(api.applications.requirements).toHaveBeenCalled());
  });

  it("offers the check from the requirements card when nothing is known", () => {
    mount();
    expect(screen.getByRole("button", { name: /Check the posting/i })).toBeTruthy();
  });
});

describe("materials", () => {
  it("creates the task on demand and generates, so the user never meets a task", async () => {
    mount();
    fireEvent.click(screen.getAllByRole("button", { name: "Generate" })[0]!);
    await waitFor(() => expect(api.applications.ensureTask).toHaveBeenCalledWith("app-1"));
    await waitFor(() => expect(api.pipelineTasks.tailor).toHaveBeenCalledWith("t1"));
  });

  it("names the state, the version and when — the record's job, not a preview", () => {
    mount({ initialTask: task(), initialArtifacts: [resumeArtifact] });
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText(/v1/)).toBeTruthy();
  });

  it("sends the deep work to the document's own route", () => {
    mount({ initialTask: task(), initialArtifacts: [resumeArtifact] });
    const open = screen.getAllByRole("link", { name: /Open/ })[0]!;
    expect(open.getAttribute("href")).toBe("/applications/app-1/doc/resume");
  });

  it("no longer previews or edits documents in place", () => {
    // The workbench is the one place to work on a document; a second, smaller
    // copy of it here is what this replaced.
    mount({ initialTask: task(), initialArtifacts: [resumeArtifact] });
    expect(screen.queryByRole("button", { name: /Change something/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Accept$/ })).toBeNull();
  });
});

describe("the form", () => {
  it("opens a fill ticket, creating the task if there is not one yet", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Open & fill" }));
    await waitFor(() => expect(api.applications.ensureTask).toHaveBeenCalled());
    await waitFor(() => expect(api.pipelineTasks.fillHandoff).toHaveBeenCalledWith("t1"));
  });

  it("shows the per-field report once a fill has run", () => {
    mount({
      initialTask: task({
        fieldReports: [
          {
            fieldId: "f1",
            label: "Email",
            classifiedType: "email",
            status: "filled",
            source: "personal",
            reason: "",
            outcome: "filled",
            required: true,
            value: "jordan@example.com",
          },
        ],
      }),
    });
    // The summary is unasked; the field-by-field detail is one click in.
    expect(screen.getByText(/1 of 1 fillable fields filled/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Re-fill" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Field by field/i }));
    expect(screen.getByText("Email")).toBeTruthy();
  });

  it("keeps the missing-fields card and its three resolutions", async () => {
    mount({
      initialTask: task({
        applicationInfo: {
          status: 2,
          filledFields: ["Email"],
          missingFields: ["Why this company?"],
          totalFields: ["Email", "Why this company?"],
        },
      }),
    });
    expect(screen.getByText(/Action Required/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /I've applied/i }));
    await waitFor(() =>
      expect(api.pipelineTasks.fillResolve).toHaveBeenCalledWith("t1", "applied-manually"),
    );
  });
});

describe("requirements", () => {
  it("names the questions with no answer rather than counting them away", () => {
    mount({
      initialRequirements: requirements({
        source: "prescan",
        total: 5,
        required: 4,
        ready: 2,
        missing: ["Why do you want to work here?"],
        freeText: 1,
      }),
    });
    expect(screen.getByText("Why do you want to work here?")).toBeTruthy();
    expect(screen.getByText(/4 required questions/i)).toBeTruthy();
  });
});

describe("effectiveResumeId", () => {
  const resumes = [
    { id: "r1", name: "Primary", isPrimary: true, hasFile: true },
    { id: "r2", name: "Other", isPrimary: false, hasFile: true },
  ] as never;

  it("prefers an explicit selection that still exists", () => {
    expect(effectiveResumeId("r2", resumes)).toBe("r2");
  });

  it("self-heals to primary when the selection is gone", () => {
    expect(effectiveResumeId("deleted", resumes)).toBe("r1");
  });
});

describe("the header's main action", () => {
  it("leads with filling — the thing this page exists to help you do", () => {
    mount();
    const primary = screen.getByRole("button", { name: /Open & fill this application/i });
    // Visually dominant, and it says what pressing it will do.
    expect(primary.className).toContain("bg-primary");
    expect(primary.getAttribute("title")).toMatch(/opens the posting/i);
    expect(screen.getByText(/lets the browser panel fill it/i)).toBeTruthy();
  });

  it("offers a re-fill once one has run", () => {
    mount({
      initialTask: task({
        fieldReports: [
          {
            fieldId: "f1",
            label: "Email",
            classifiedType: "email",
            status: "filled",
            source: "personal",
            reason: "",
            outcome: "filled",
            required: true,
          },
        ],
      }),
    });
    expect(screen.getByRole("button", { name: /Re-fill this application/i })).toBeTruthy();
  });

  it("reaches the same handoff as everything else — one path, not a second one", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Open & fill this application/i }));
    await waitFor(() => expect(api.applications.ensureTask).toHaveBeenCalledWith("app-1"));
    await waitFor(() => expect(api.pipelineTasks.fillHandoff).toHaveBeenCalledWith("t1"));
  });

  it("keeps the ticket confirmation where the button that made it is", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Open & fill this application/i }));
    expect(await screen.findAllByText(/Ticket created/)).not.toHaveLength(0);
  });

  it("is disabled, and says why, with no link to open", () => {
    // Silently doing nothing is the failure mode worth avoiding here.
    mount({
      application: { ...application, jobInfo: { ...application.jobInfo, applyLink: undefined } },
    });
    const primary = screen.getByRole("button", { name: /Open & fill this application/i });
    expect(primary.hasAttribute("disabled")).toBe(true);
    expect(primary.getAttribute("title")).toMatch(/no application link/i);
    expect(screen.getByText(/No application link saved for this job/i)).toBeTruthy();
  });

  it("disappears once the application has been sent — filling again means nothing", () => {
    for (const status of ["applied", "interview", "offer", "rejected", "archived"] as const) {
      cleanup();
      mount({ application: { ...application, status } });
      expect(screen.queryByRole("button", { name: /this application/i })).toBeNull();
      // The quiet way back to the posting is still there.
      expect(screen.getByRole("link", { name: /Original posting/i })).toBeTruthy();
    }
  });

  it("still leads while the application is only saved or applying", () => {
    for (const status of ["saved", "applying"] as const) {
      cleanup();
      mount({ application: { ...application, status } });
      expect(screen.getByRole("button", { name: /this application/i })).toBeTruthy();
    }
  });

  it("leaves exactly one dominant control in the header", () => {
    // Check job and Ask agent were competing with it; the inversion this fixes
    // was that Ask agent was the only primary-styled thing up here.
    mount();
    const header = document.querySelector("header")!;
    const dominant = [...header.querySelectorAll("button, a")].filter((el) =>
      el.className.includes("bg-primary "),
    );
    expect(dominant).toHaveLength(1);
    expect(dominant[0]!.textContent).toMatch(/Open & fill this application/);
  });
});
