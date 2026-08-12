// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { GeneratedDocuments } from "../generated-documents";
import { resolveTab } from "../documents-nav";
import { api } from "@/lib/api-client";
import type { DocumentRow } from "@/server/services/document-service";

/**
 * The cross-application list of what OfferOS wrote.
 *
 * Two things here are worth pinning: a rename must land on the row without a
 * page reload, and deleting a tailored résumé must tell the truth about what
 * happens to the fill attachment — before the click, and again after it.
 */

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: { documents: { rename: vi.fn(), remove: vi.fn() } },
  };
});

afterEach(cleanup);

const row = (over: Partial<DocumentRow> = {}): DocumentRow => ({
  taskId: "task-1",
  applicationId: "app-1",
  kind: "resume",
  name: "resume_Acme_2026-08-12",
  company: "Acme",
  title: "ML Engineer",
  versions: 2,
  state: "draft",
  updatedAt: Date.now() - 60_000,
  ...over,
});

describe("empty state", () => {
  it("points at the applications, since that is where documents come from", () => {
    render(<GeneratedDocuments initial={[]} />);
    expect(screen.getByText(/Nothing generated yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Go to your applications/ }).getAttribute("href")).toBe(
      "/",
    );
  });
});

describe("a row", () => {
  it("shows what it is, which job it belongs to, and where to open it", () => {
    render(<GeneratedDocuments initial={[row()]} />);

    expect(screen.getByText("resume_Acme_2026-08-12")).toBeTruthy();
    expect(screen.getByText(/Tailored résumé/)).toBeTruthy();
    expect(screen.getByText(/v2/)).toBeTruthy();
    expect(screen.getByText(/Draft/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Acme — ML Engineer/ }).getAttribute("href")).toBe(
      "/applications/app-1",
    );
    expect(screen.getByRole("link", { name: /Open in the workbench/ }).getAttribute("href")).toBe(
      "/applications/app-1/doc/resume",
    );
    expect(screen.getByRole("link", { name: /PDF/ }).getAttribute("href")).toBe(
      "/api/v1/agent/tasks/task-1/artifacts/resume/pdf",
    );
  });

  it("renames in place, and keeps the name the server actually stored", () => {
    vi.mocked(api.documents.rename).mockResolvedValue({ name: "the one that worked" });
    render(<GeneratedDocuments initial={[row()]} />);

    fireEvent.click(screen.getByRole("button", { name: /Rename resume_Acme/ }));
    fireEvent.change(screen.getByLabelText(/Rename resume_Acme/), {
      target: { value: "  the one that worked  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    return waitFor(() => {
      expect(api.documents.rename).toHaveBeenCalledWith("task-1", "resume", "the one that worked");
      expect(screen.getByText("the one that worked")).toBeTruthy();
    });
  });
});

describe("deleting", () => {
  it("says what it will do to the fill attachment before doing it", () => {
    const note =
      "This application attaches the tailored résumé. Deleting it switches the attachment to your original file (jordan.pdf).";
    render(<GeneratedDocuments initial={[row({ deleteNote: note })]} />);

    fireEvent.click(screen.getByRole("button", { name: /Delete resume_Acme/ }));
    expect(
      screen.getByText(new RegExp("switches the attachment to your original file")),
    ).toBeTruthy();
  });

  it("asks plainly when there is no consequence to explain", () => {
    render(<GeneratedDocuments initial={[row({ kind: "cover-letter", name: "cover_Acme" })]} />);
    fireEvent.click(screen.getByRole("button", { name: /Delete cover_Acme/ }));
    expect(screen.getByText("Delete this document?")).toBeTruthy();
  });

  it("removes the row and reports the attachment change that actually happened", async () => {
    vi.mocked(api.documents.remove).mockResolvedValue({
      name: "resume_Acme_2026-08-12",
      attachmentSwitchedToOriginal: true,
    });
    render(<GeneratedDocuments initial={[row()]} />);

    fireEvent.click(screen.getByRole("button", { name: /Delete resume_Acme/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.queryByText("resume_Acme_2026-08-12")).toBeNull();
      expect(screen.getByText(/will attach your original résumé file now/)).toBeTruthy();
    });
  });

  it("keeps the row when the delete fails", async () => {
    vi.mocked(api.documents.remove).mockRejectedValue(new Error("nope"));
    render(<GeneratedDocuments initial={[row()]} />);

    fireEvent.click(screen.getByRole("button", { name: /Delete resume_Acme/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.getByText("nope")).toBeTruthy());
    expect(screen.getByText("resume_Acme_2026-08-12")).toBeTruthy();
  });
});

describe("which tab the URL asks for", () => {
  it("falls back to Generated rather than 404ing a stale link", () => {
    expect(resolveTab("templates")).toBe("templates");
    expect(resolveTab("resumes")).toBe("resumes");
    expect(resolveTab(undefined)).toBe("generated");
    expect(resolveTab("nonsense")).toBe("generated");
  });
});
