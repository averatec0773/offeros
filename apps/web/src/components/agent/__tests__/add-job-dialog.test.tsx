// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Application } from "@offeros/core";
import { AddJobDialog } from "../add-job-dialog";
import { api } from "@/lib/api-client";

/**
 * The confusing half of a real incident: adding a job reported a duplicate and
 * navigated straight to an unrelated application saved weeks earlier. Nothing
 * was created and nothing said so, so the user believed it had been.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, api: { ...actual.api, applications: { create: vi.fn() } } };
});

afterEach(cleanup);
beforeEach(() => push.mockClear());

const existing: Application = {
  id: "app-old",
  jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
  status: "saved",
  createdAt: 1,
  updatedAt: 1,
};

async function addLink(url = "https://boards.greenhouse.io/acme/jobs/1234567") {
  render(<AddJobDialog />);
  fireEvent.click(screen.getByRole("button", { name: /Add a job/i }));
  fireEvent.change(screen.getByLabelText("Posting URL"), { target: { value: url } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
}

describe("a new job", () => {
  it("opens the application it just created", async () => {
    vi.mocked(api.applications.create).mockResolvedValue({
      application: { ...existing, id: "app-new" },
      duplicate: false,
    });
    await addLink();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/applications/app-new"));
  });
});

describe("a job already tracked", () => {
  beforeEach(() => {
    vi.mocked(api.applications.create).mockResolvedValue({
      application: existing,
      duplicate: true,
    });
  });

  it("says so, and names the job it already has", async () => {
    await addLink();
    expect(await screen.findByText(/already tracking this job/i)).toBeTruthy();
    expect(screen.getByText(/ML Engineer at Acme/)).toBeTruthy();
    expect(screen.getByText(/Nothing new was added/i)).toBeTruthy();
  });

  it("does NOT navigate on its own — the user must know what they are seeing", async () => {
    await addLink();
    await screen.findByText(/already tracking this job/i);
    expect(push).not.toHaveBeenCalled();
  });

  it("still offers to open it, on purpose", async () => {
    await addLink();
    fireEvent.click(await screen.findByRole("button", { name: "Open it" }));
    expect(push).toHaveBeenCalledWith("/applications/app-old");
  });

  it("lets them try a different link without reopening the dialog", async () => {
    await addLink();
    fireEvent.click(await screen.findByRole("button", { name: /Add a different link/i }));
    expect(screen.queryByText(/already tracking this job/i)).toBeNull();
    expect((screen.getByLabelText("Posting URL") as HTMLInputElement).value).toBe("");
  });
});
