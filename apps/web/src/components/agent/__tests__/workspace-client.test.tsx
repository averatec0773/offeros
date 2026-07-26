// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  PIPELINE_STEPS,
  type AgentTask,
  type Application,
  type FitAnalysis,
  type ResumeSummary,
} from "@offeros/core";
import { WorkspaceClient, deriveGate, shouldPoll, effectiveResumeId } from "../workspace-client";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({
  api: {
    agentTasks: {
      get: vi.fn(),
      create: vi.fn(),
      start: vi.fn(),
      pause: vi.fn(),
      advance: vi.fn(),
      choice: vi.fn(),
      tweak: vi.fn(),
      fillHandoff: vi.fn(),
      fillResolve: vi.fn(),
    },
    applications: {
      update: vi.fn(),
    },
    resumes: {
      list: vi.fn(),
    },
    fit: {
      get: vi.fn(),
      recompute: vi.fn(),
    },
  },
}));

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
const SUBMIT_STEP = PIPELINE_STEPS.findIndex((s) => s.key === "submit");

function baseTask(overrides: Partial<AgentTask>): AgentTask {
  return {
    id: "t1",
    applicationId: "app-1",
    status: "awaiting_user",
    coverLetterRequirement: "unknown",
    skippedCoverLetter: false,
    step: FILL_STEP,
    fieldReports: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(api.agentTasks.get).mockResolvedValue({
    task: baseTask({}),
    jdAnalysis: null,
    artifacts: [],
  });
  vi.mocked(api.agentTasks.fillHandoff).mockResolvedValue({
    id: "h1",
    taskId: "t1",
    applicationId: "app-1",
    applyLink: "https://ats.example/apply",
    status: "pending",
    createdAt: 1,
    updatedAt: 1,
  });
  vi.mocked(api.agentTasks.advance).mockResolvedValue(
    baseTask({ status: "done", step: PIPELINE_STEPS.length }),
  );
  vi.mocked(api.resumes.list).mockResolvedValue([]);
  vi.spyOn(window, "open").mockImplementation(() => null);
});

describe("WorkspaceClient — fill handoff states", () => {
  it("fill-form gate: Open & fill creates a handoff, opens the apply link, and shows ticket-created feedback", async () => {
    const task = baseTask({});
    render(
      <WorkspaceClient
        application={application}
        initialTask={task}
        initialJdAnalysis={null}
        initialArtifacts={[]}
        initialFit={null}
      />,
    );

    fireEvent.click(screen.getByText(/Open & fill/i));

    await waitFor(() => expect(api.agentTasks.fillHandoff).toHaveBeenCalledWith("t1"));
    expect(window.open).toHaveBeenCalledWith("https://ats.example/apply", "_blank");
    await waitFor(() => expect(screen.getByText(/Ticket created/i)).toBeTruthy());
  });

  it("action-required (status 2): hides the Open & fill card and Re-fill opens a new handoff", async () => {
    const task = baseTask({
      applicationInfo: { status: 2, filledFields: [], missingFields: ["LinkedIn Profile"] },
    });
    render(
      <WorkspaceClient
        application={application}
        initialTask={task}
        initialJdAnalysis={null}
        initialArtifacts={[]}
        initialFit={null}
      />,
    );

    expect(screen.queryByText(/^Open & fill$/i)).toBeNull();
    expect(screen.getByText("LinkedIn Profile")).toBeTruthy();

    fireEvent.click(screen.getByText(/Re-fill/i));
    await waitFor(() => expect(api.agentTasks.fillHandoff).toHaveBeenCalledWith("t1"));
  });

  it("submit gate: Mark as submitted calls advance", async () => {
    const task = baseTask({
      step: SUBMIT_STEP,
      applicationInfo: { status: 1, filledFields: ["Full name"], missingFields: [] },
    });
    render(
      <WorkspaceClient
        application={application}
        initialTask={task}
        initialJdAnalysis={null}
        initialArtifacts={[]}
        initialFit={null}
      />,
    );

    expect(screen.getByText(/Ready to submit/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/Mark as submitted/i));

    await waitFor(() => expect(api.agentTasks.advance).toHaveBeenCalledWith("t1"));
  });

  it("opens the apply link synchronously (before the handoff call resolves) to avoid popup blockers", async () => {
    const task = baseTask({});
    let resolveHandoff!: (value: Awaited<ReturnType<typeof api.agentTasks.fillHandoff>>) => void;
    vi.mocked(api.agentTasks.fillHandoff).mockReturnValue(
      new Promise((resolve) => {
        resolveHandoff = resolve;
      }),
    );

    render(
      <WorkspaceClient
        application={application}
        initialTask={task}
        initialJdAnalysis={null}
        initialArtifacts={[]}
        initialFit={null}
      />,
    );

    fireEvent.click(screen.getByText(/Open & fill/i));

    // window.open fires immediately, before the fillHandoff promise settles.
    expect(window.open).toHaveBeenCalledWith("https://ats.example/apply", "_blank");
    expect(screen.queryByText(/Ticket created/i)).toBeNull();

    resolveHandoff({
      id: "h1",
      taskId: "t1",
      applicationId: "app-1",
      applyLink: "https://ats.example/apply",
      status: "pending",
      createdAt: 1,
      updatedAt: 1,
    });
    await waitFor(() => expect(screen.getByText(/Ticket created/i)).toBeTruthy());
  });
});

describe("WorkspaceClient — ticketCreated reset", () => {
  it("clears stale 'Ticket created' feedback once the gate leaves fill-form and later returns to it", async () => {
    const task = baseTask({});
    // After the handoff, the extension reports missing fields (gate leaves
    // fill-form for action-required); after "Fixed" is acknowledged, the
    // pipeline lands back on a fresh fill-form gate with no ticket yet.
    vi.mocked(api.agentTasks.get)
      .mockResolvedValueOnce({
        task: baseTask({
          applicationInfo: { status: 2, filledFields: [], missingFields: ["LinkedIn Profile"] },
        }),
        jdAnalysis: null,
        artifacts: [],
      })
      .mockResolvedValueOnce({
        task: baseTask({}),
        jdAnalysis: null,
        artifacts: [],
      });

    render(
      <WorkspaceClient
        application={application}
        initialTask={task}
        initialJdAnalysis={null}
        initialArtifacts={[]}
        initialFit={null}
      />,
    );

    fireEvent.click(screen.getByText(/Open & fill/i));
    await waitFor(() => expect(screen.getByText(/Fixed/i)).toBeTruthy());
    // Gate moved to action-required (null): ticketCreated was reset even
    // though it had been set true a moment earlier.
    expect(screen.queryByText(/Ticket created/i)).toBeNull();

    fireEvent.click(screen.getByText(/Fixed/i));
    await waitFor(() => expect(screen.getByText(/^Open & fill$/i)).toBeTruthy());
    // Back at a fresh fill-form gate: no stale "Ticket created" message.
    expect(screen.queryByText(/Ticket created/i)).toBeNull();
  });
});

describe("WorkspaceClient — status bar", () => {
  it("does not show Action Required once the task is done, even if applicationInfo.status is stale at 2", () => {
    const task = baseTask({
      status: "done",
      step: PIPELINE_STEPS.length,
      applicationInfo: { status: 2, filledFields: [], missingFields: ["LinkedIn Profile"] },
    });
    render(
      <WorkspaceClient
        application={application}
        initialTask={task}
        initialJdAnalysis={null}
        initialArtifacts={[]}
        initialFit={null}
      />,
    );

    expect(screen.queryByText(/Action Required/i)).toBeNull();
  });
});

describe("WorkspaceClient — fit card", () => {
  const fit: FitAnalysis = {
    id: "fit-1",
    applicationId: "app-1",
    version: 1,
    overall: 82,
    label: "Strong match",
    subScores: { experience: 80, skills: 85, education: 70 },
    whyMatch: "Solid overlap with the JD.",
    alignedSkills: [{ skill: "Python", evidence: "Shipped ML systems" }],
    notAlignedSkills: [{ skill: "Kubernetes", advice: "Take a course" }],
    createdAt: 1,
  };

  it("renders the initial fit and recomputes on demand", async () => {
    const recomputed = { ...fit, overall: 91, label: "Excellent match" };
    vi.mocked(api.fit.recompute).mockResolvedValue(recomputed);

    render(
      <WorkspaceClient
        application={application}
        initialTask={baseTask({})}
        initialJdAnalysis={null}
        initialArtifacts={[]}
        initialFit={fit}
      />,
    );

    expect(screen.getByText("Strong match")).toBeTruthy();

    fireEvent.click(screen.getByText(/^Recompute$/i));
    await waitFor(() => expect(api.fit.recompute).toHaveBeenCalledWith("app-1"));
    await waitFor(() => expect(screen.getByText("Excellent match")).toBeTruthy());
  });

  it("renders nothing when there is no fit yet", () => {
    render(
      <WorkspaceClient
        application={application}
        initialTask={baseTask({})}
        initialJdAnalysis={null}
        initialArtifacts={[]}
        initialFit={null}
      />,
    );
    expect(screen.queryByText(/Recompute/i)).toBeNull();
  });
});

describe("deriveGate", () => {
  it("returns 'submit' at the submit step when applicationInfo.status is undefined or 1", () => {
    const submitStep = PIPELINE_STEPS.findIndex((s) => s.key === "submit");
    expect(deriveGate(baseTask({ step: submitStep, applicationInfo: undefined }))).toBe("submit");
    expect(
      deriveGate(
        baseTask({
          step: submitStep,
          applicationInfo: { status: 1, filledFields: [], missingFields: [] },
        }),
      ),
    ).toBe("submit");
  });

  it("defensively withholds 'submit' at the submit step when applicationInfo.status is still 2", () => {
    const submitStep = PIPELINE_STEPS.findIndex((s) => s.key === "submit");
    expect(
      deriveGate(
        baseTask({
          step: submitStep,
          applicationInfo: { status: 2, filledFields: [], missingFields: ["LinkedIn Profile"] },
        }),
      ),
    ).toBeNull();
  });
});

describe("effectiveResumeId", () => {
  const primary: ResumeSummary = {
    id: "r-primary",
    name: "Primary.pdf",
    mimeType: "application/pdf",
    isPrimary: true,
    createdAt: 1,
  };
  const other: ResumeSummary = { ...primary, id: "r-other", name: "Other.pdf", isPrimary: false };

  it("returns the explicit selection when set", () => {
    expect(effectiveResumeId("r-other", [primary, other])).toBe("r-other");
  });

  it("falls back to the primary resume when nothing is selected", () => {
    expect(effectiveResumeId(undefined, [primary, other])).toBe("r-primary");
  });

  it("self-heals to primary when the selection points at a deleted resume", () => {
    expect(effectiveResumeId("r-deleted", [primary, other])).toBe("r-primary");
  });

  it("returns undefined when there is no selection and no primary", () => {
    expect(effectiveResumeId(undefined, [other])).toBeUndefined();
  });
});

describe("WorkspaceClient — résumé picker", () => {
  const primary: ResumeSummary = {
    id: "r-primary",
    name: "Primary.pdf",
    mimeType: "application/pdf",
    isPrimary: true,
    createdAt: 1,
  };
  const backend: ResumeSummary = {
    id: "r-backend",
    name: "Backend.pdf",
    mimeType: "application/pdf",
    isPrimary: false,
    note: "For backend roles",
    createdAt: 1,
  };

  it("defaults the selection to the primary résumé when the application has none", async () => {
    vi.mocked(api.resumes.list).mockResolvedValue([primary, backend]);
    render(
      <WorkspaceClient
        application={application}
        initialTask={baseTask({})}
        initialJdAnalysis={null}
        initialArtifacts={[]}
        initialFit={null}
      />,
    );

    const select = (await screen.findByLabelText(
      /résumé for this application/i,
    )) as HTMLSelectElement;
    expect(select.value).toBe("r-primary");
  });

  it("persists the selection via applications.update and reflects it locally", async () => {
    vi.mocked(api.resumes.list).mockResolvedValue([primary, backend]);
    vi.mocked(api.applications.update).mockResolvedValue({
      ...application,
      resumeId: "r-backend",
    });

    render(
      <WorkspaceClient
        application={application}
        initialTask={baseTask({})}
        initialJdAnalysis={null}
        initialArtifacts={[]}
        initialFit={null}
      />,
    );

    const select = (await screen.findByLabelText(
      /résumé for this application/i,
    )) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "r-backend" } });

    await waitFor(() =>
      expect(api.applications.update).toHaveBeenCalledWith("app-1", { resumeId: "r-backend" }),
    );
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("r-backend"));
  });

  it("uses the application's stored resumeId when present", async () => {
    vi.mocked(api.resumes.list).mockResolvedValue([primary, backend]);
    render(
      <WorkspaceClient
        application={{ ...application, resumeId: "r-backend" }}
        initialTask={baseTask({})}
        initialJdAnalysis={null}
        initialArtifacts={[]}
        initialFit={null}
      />,
    );

    const select = (await screen.findByLabelText(
      /résumé for this application/i,
    )) as HTMLSelectElement;
    expect(select.value).toBe("r-backend");
  });
});

describe("shouldPoll", () => {
  it("polls while the task is running", () => {
    expect(shouldPoll(baseTask({ status: "running" }))).toBe(true);
  });

  it("polls while awaiting_user at the fill-form gate", () => {
    expect(shouldPoll(baseTask({ status: "awaiting_user", step: FILL_STEP }))).toBe(true);
  });

  it("does not poll while awaiting_user at a non-fill-form gate", () => {
    const confirmResumeStep = PIPELINE_STEPS.findIndex((s) => s.key === "confirm-resume");
    expect(shouldPoll(baseTask({ status: "awaiting_user", step: confirmResumeStep }))).toBe(false);
  });

  it("does not poll when done or when there is no task", () => {
    expect(shouldPoll(baseTask({ status: "done", step: PIPELINE_STEPS.length }))).toBe(false);
    expect(shouldPoll(null)).toBe(false);
  });
});
