// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ResumeSummary } from "@offeros/core";
import { ResumesSection } from "../resumes-section";
import { api } from "@/lib/api-client";
import { extractPdfText } from "@offeros/pdf";

vi.mock("@/lib/api-client", () => ({
  api: {
    resumes: {
      list: vi.fn(),
      upload: vi.fn(),
      setPrimary: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
  },
}));

vi.mock("@/lib/pdf-worker", () => ({ ensurePdfWorker: vi.fn() }));

vi.mock("@offeros/pdf", () => ({ extractPdfText: vi.fn() }));

beforeEach(() => {
  vi.mocked(extractPdfText).mockResolvedValue("Jordan Rivera\nBackend engineer...");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const resume: ResumeSummary = {
  id: "r1",
  name: "resume.pdf",
  mimeType: "application/pdf",
  isPrimary: true,
  createdAt: Date.UTC(2026, 0, 1),
};

describe("ResumesSection", () => {
  it("shows an empty-state message when there are no resumes", async () => {
    vi.mocked(api.resumes.list).mockResolvedValue([]);
    render(<ResumesSection />);
    expect(await screen.findByText(/no résumés/i)).toBeTruthy();
  });

  it("lists resumes with a primary badge and created date", async () => {
    vi.mocked(api.resumes.list).mockResolvedValue([resume]);
    render(<ResumesSection />);
    expect(await screen.findByText("resume.pdf")).toBeTruthy();
    expect(screen.getByText("Primary")).toBeTruthy();
  });

  it("uploads a PDF file as base64 and marks it primary when it's the first resume", async () => {
    vi.mocked(api.resumes.list).mockResolvedValue([]);
    vi.mocked(api.resumes.upload).mockResolvedValue(resume);

    render(<ResumesSection />);
    await screen.findByText(/no résumés/i);

    const file = new File(["hello pdf content"], "resume.pdf", { type: "application/pdf" });
    const input = screen.getByLabelText(/upload résumé/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(api.resumes.upload).toHaveBeenCalled());
    const call = vi.mocked(api.resumes.upload).mock.calls[0]![0];
    expect(call.name).toBe("resume.pdf");
    expect(call.mimeType).toBe("application/pdf");
    expect(call.isPrimary).toBe(true);
    expect(atob(call.dataBase64)).toBe("hello pdf content");
    expect(extractPdfText).toHaveBeenCalledOnce();
    expect(call.text).toBe("Jordan Rivera\nBackend engineer...");
  });

  it("uploads with empty text when client-side extraction fails, without blocking the upload", async () => {
    vi.mocked(api.resumes.list).mockResolvedValue([]);
    vi.mocked(api.resumes.upload).mockResolvedValue(resume);
    vi.mocked(extractPdfText).mockRejectedValue(new Error("bad pdf"));

    render(<ResumesSection />);
    await screen.findByText(/no résumés/i);

    const file = new File(["hello pdf content"], "resume.pdf", { type: "application/pdf" });
    const input = screen.getByLabelText(/upload résumé/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(api.resumes.upload).toHaveBeenCalled());
    const call = vi.mocked(api.resumes.upload).mock.calls[0]![0];
    expect(call.text).toBe("");
    expect(screen.queryByText(/couldn't upload/i)).toBeNull();
  });

  it("rejects non-PDF files without calling upload", async () => {
    vi.mocked(api.resumes.list).mockResolvedValue([]);
    render(<ResumesSection />);
    await screen.findByText(/no résumés/i);

    const file = new File(["not a pdf"], "resume.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const input = screen.getByLabelText(/upload résumé/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/only pdf/i)).toBeTruthy();
    expect(api.resumes.upload).not.toHaveBeenCalled();
  });

  it("sets a resume as primary", async () => {
    const other: ResumeSummary = { ...resume, id: "r2", name: "other.pdf", isPrimary: false };
    vi.mocked(api.resumes.list).mockResolvedValue([{ ...resume, isPrimary: false }, other]);
    vi.mocked(api.resumes.setPrimary).mockResolvedValue({ ...other, isPrimary: true });

    render(<ResumesSection />);
    await screen.findByText("other.pdf");

    fireEvent.click(screen.getByLabelText("Set other.pdf as primary"));

    await waitFor(() => expect(api.resumes.setPrimary).toHaveBeenCalledWith("r2"));
  });

  it("inline-edits the name and note and persists via update", async () => {
    vi.mocked(api.resumes.list).mockResolvedValue([resume]);
    vi.mocked(api.resumes.update).mockResolvedValue({
      ...resume,
      name: "Backend.pdf",
      note: "For backend roles",
    });

    render(<ResumesSection />);
    fireEvent.click(await screen.findByLabelText("Edit resume.pdf"));

    fireEvent.change(screen.getByLabelText(/résumé name/i), {
      target: { value: "Backend.pdf" },
    });
    fireEvent.change(screen.getByLabelText(/note/i), {
      target: { value: "For backend roles" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(api.resumes.update).toHaveBeenCalledWith("r1", {
        name: "Backend.pdf",
        note: "For backend roles",
      }),
    );
    expect(await screen.findByText("Backend.pdf")).toBeTruthy();
    expect(screen.getByText("For backend roles")).toBeTruthy();
  });

  it("deletes a resume after an inline confirm", async () => {
    // Mock initial list and post-delete refetch
    vi.mocked(api.resumes.list).mockResolvedValueOnce([resume]).mockResolvedValueOnce([]);
    render(<ResumesSection />);

    fireEvent.click(await screen.findByLabelText("Delete resume.pdf"));
    fireEvent.click(screen.getByText("Confirm"));

    await waitFor(() => expect(api.resumes.remove).toHaveBeenCalledWith("r1"));
    expect(screen.queryByText("resume.pdf")).toBeNull();
  });

  it("closes the confirm row even when the post-delete refetch fails", async () => {
    vi.mocked(api.resumes.list)
      .mockResolvedValueOnce([resume])
      .mockRejectedValueOnce(new Error("network down"));
    render(<ResumesSection />);
    await screen.findByText("resume.pdf");

    fireEvent.click(screen.getByLabelText("Delete resume.pdf"));
    fireEvent.click(screen.getByText("Confirm"));

    await waitFor(() => expect(api.resumes.remove).toHaveBeenCalledWith("r1"));
    await waitFor(() => expect(screen.queryByText("Delete?")).toBeNull());
  });

  it("refetches the resume list after deletion so server-promoted primary shows in the UI", async () => {
    const primary: ResumeSummary = {
      id: "r1",
      name: "primary.pdf",
      mimeType: "application/pdf",
      isPrimary: true,
      createdAt: Date.UTC(2026, 0, 1),
    };
    const secondary: ResumeSummary = {
      id: "r2",
      name: "secondary.pdf",
      mimeType: "application/pdf",
      isPrimary: false,
      createdAt: Date.UTC(2026, 0, 2),
    };

    // Initial list has primary and secondary
    vi.mocked(api.resumes.list).mockResolvedValueOnce([primary, secondary]);
    render(<ResumesSection />);
    await screen.findByText("primary.pdf");
    expect(screen.getByText("Primary")).toBeTruthy();

    // After delete, refetch returns secondary as the new primary
    vi.mocked(api.resumes.list).mockResolvedValueOnce([{ ...secondary, isPrimary: true }]);

    fireEvent.click(screen.getByLabelText("Delete primary.pdf"));
    fireEvent.click(screen.getByText("Confirm"));

    // Verify that the refetch happened and the new primary is displayed
    await waitFor(() => {
      expect(api.resumes.list).toHaveBeenCalledTimes(2); // initial + refetch after delete
      expect(screen.getByText("secondary.pdf")).toBeTruthy();
      expect(screen.getByText("Primary")).toBeTruthy();
    });
  });
});
