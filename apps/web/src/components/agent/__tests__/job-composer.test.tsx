// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { JobComposer } from "../job-composer";
import { api } from "@/lib/api-client";
import type { AgentTask } from "@offeros/core";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/api-client", () => ({
  api: {
    agentTasks: {
      createFromJd: vi.fn(),
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fillForm({
  company = "Evolver",
  title = "GenAI Engineer",
  link = "",
  jd = "We are hiring an ML engineer to lead our GenAI platform.",
}: { company?: string; title?: string; link?: string; jd?: string } = {}) {
  if (company)
    fireEvent.change(screen.getByPlaceholderText("Company"), {
      target: { value: company },
    });
  if (title)
    fireEvent.change(screen.getByPlaceholderText("Job title"), {
      target: { value: title },
    });
  if (link) {
    fireEvent.change(screen.getByPlaceholderText("Posting URL (optional)"), {
      target: { value: link },
    });
  }
  if (jd) {
    fireEvent.change(screen.getByPlaceholderText("Paste the full job description here…"), {
      target: { value: jd },
    });
  }
}

describe("JobComposer", () => {
  it("disables Start tailoring until both company and JD text are present", () => {
    render(<JobComposer />);
    const button = screen.getByRole("button", { name: "Start tailoring" });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Company"), { target: { value: "Evolver" } });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Paste the full job description here…"), {
      target: { value: "A job description." },
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("treats whitespace-only input as empty", () => {
    render(<JobComposer />);
    fireEvent.change(screen.getByPlaceholderText("Company"), { target: { value: "   " } });
    fireEvent.change(screen.getByPlaceholderText("Paste the full job description here…"), {
      target: { value: "   " },
    });
    expect(
      (screen.getByRole("button", { name: "Start tailoring" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("submits the trimmed jobInfo + jdText shape and navigates to the new application on success", async () => {
    vi.mocked(api.agentTasks.createFromJd).mockResolvedValue({
      id: "task-1",
      applicationId: "app-1",
      status: "queued",
      step: 0,
      coverLetterRequirement: "unknown",
      skippedCoverLetter: false,
      fieldReports: [],
      createdAt: 1,
      updatedAt: 1,
    });

    render(<JobComposer />);
    fillForm({
      company: "  Evolver  ",
      title: "  GenAI Engineer  ",
      link: "  https://evolver.example/jobs/1  ",
      jd: "  We are hiring an ML engineer.  ",
    });
    fireEvent.click(screen.getByRole("button", { name: "Start tailoring" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/applications/app-1"));

    expect(api.agentTasks.createFromJd).toHaveBeenCalledTimes(1);
    const call = vi.mocked(api.agentTasks.createFromJd).mock.calls[0]![0];
    expect(call.jobInfo.companyName).toBe("Evolver");
    expect(call.jobInfo.jobTitle).toBe("GenAI Engineer");
    expect(call.jobInfo.applyLink).toBe("https://evolver.example/jobs/1");
    expect(call.jdText).toBe("We are hiring an ML engineer.");
    expect(typeof call.jobInfo.jobId).toBe("string");
    expect(call.jobInfo.jobId.length).toBeGreaterThan(0);
  });

  it("falls back to 'Untitled role' and omits applyLink when they're left blank", async () => {
    vi.mocked(api.agentTasks.createFromJd).mockResolvedValue({
      id: "task-2",
      applicationId: "app-2",
      status: "queued",
      step: 0,
      coverLetterRequirement: "unknown",
      skippedCoverLetter: false,
      fieldReports: [],
      createdAt: 1,
      updatedAt: 1,
    });

    render(<JobComposer />);
    fillForm({ title: "" });
    fireEvent.click(screen.getByRole("button", { name: "Start tailoring" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/applications/app-2"));
    const call = vi.mocked(api.agentTasks.createFromJd).mock.calls[0]![0];
    expect(call.jobInfo.jobTitle).toBe("Untitled role");
    expect(call.jobInfo.applyLink).toBeUndefined();
  });

  it("shows an error and re-enables the button when the create call fails", async () => {
    vi.mocked(api.agentTasks.createFromJd).mockRejectedValue(new Error("network down"));

    render(<JobComposer />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Start tailoring" }));

    await waitFor(() =>
      expect(screen.getByText("Couldn't create that application. Try again.")).toBeTruthy(),
    );
    expect(push).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "Start tailoring" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("shows pending state on the button while the request is in flight", async () => {
    let resolveCall: (value: AgentTask) => void = () => {};
    vi.mocked(api.agentTasks.createFromJd).mockReturnValue(
      new Promise<AgentTask>((resolve) => {
        resolveCall = resolve;
      }),
    );

    render(<JobComposer />);
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Start tailoring" }));

    expect(screen.getByRole("button", { name: "Creating…" })).toBeTruthy();
    resolveCall({
      id: "task-3",
      applicationId: "app-3",
      status: "queued",
      step: 0,
      coverLetterRequirement: "unknown",
      skippedCoverLetter: false,
      fieldReports: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/applications/app-3"));
  });
});
