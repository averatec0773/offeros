// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Template } from "@offeros/core";
import { TemplatesClient } from "../templates-client";
import { api } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({
  api: {
    templates: {
      list: vi.fn(),
      save: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      analyze: vi.fn(),
      preview: vi.fn(),
    },
  },
}));

function stubObjectUrl() {
  const createObjectURL = vi.fn(() => "blob:mock-url");
  const revokeObjectURL = vi.fn();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  return { createObjectURL, revokeObjectURL };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const t1: Template = {
  id: "t1",
  name: "averatec cover letter",
  kind: "cover-letter",
  renderer: "latex",
  content: "%% OFFEROS-BODY-START\nhello\n%% OFFEROS-BODY-END",
  scaffoldHints: 'Salutation: "Dear Hiring Team,". Closing: "Sincerely,". Body: 4 paragraphs.',
  isDefault: true,
  createdAt: Date.UTC(2026, 0, 1),
  updatedAt: Date.UTC(2026, 0, 1),
};

const t2: Template = {
  ...t1,
  id: "t2",
  name: "backup template",
  renderer: "builtin",
  isDefault: false,
};

describe("TemplatesClient", () => {
  it("shows an empty-state message when there are no templates", async () => {
    vi.mocked(api.templates.list).mockResolvedValue([]);
    render(<TemplatesClient />);
    expect(await screen.findByText(/no templates/i)).toBeTruthy();
  });

  it("lists templates with a renderer badge and a default indicator", async () => {
    vi.mocked(api.templates.list).mockResolvedValue([t1, t2]);
    render(<TemplatesClient />);

    expect(await screen.findByText("averatec cover letter")).toBeTruthy();
    expect(screen.getByText("backup template")).toBeTruthy();
    expect(screen.getByText("latex")).toBeTruthy();
    expect(screen.getByText("builtin")).toBeTruthy();
    expect(screen.getByLabelText("Default template")).toBeTruthy();
    expect(screen.getByLabelText("Set backup template as default")).toBeTruthy();
  });

  it("sets a template as default", async () => {
    vi.mocked(api.templates.list).mockResolvedValue([t1, t2]);
    vi.mocked(api.templates.update).mockResolvedValue({ ...t2, isDefault: true });

    render(<TemplatesClient />);
    fireEvent.click(await screen.findByLabelText("Set backup template as default"));

    await waitFor(() =>
      expect(api.templates.update).toHaveBeenCalledWith("t2", {
        name: t2.name,
        kind: t2.kind,
        renderer: t2.renderer,
        content: t2.content,
        scaffoldHints: t2.scaffoldHints,
        isDefault: true,
      }),
    );
  });

  it("edits a template's name, scaffoldHints, and content", async () => {
    vi.mocked(api.templates.list).mockResolvedValue([t1]);
    vi.mocked(api.templates.update).mockResolvedValue({
      ...t1,
      name: "renamed letter",
      scaffoldHints: "new hints",
      content: "%% OFFEROS-BODY-START\nnew body\n%% OFFEROS-BODY-END",
    });

    render(<TemplatesClient />);
    fireEvent.click(await screen.findByLabelText("Edit averatec cover letter"));

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "renamed letter" } });
    fireEvent.change(screen.getByLabelText("Scaffold hints"), {
      target: { value: "new hints" },
    });
    fireEvent.change(screen.getByLabelText("Content"), {
      target: { value: "%% OFFEROS-BODY-START\nnew body\n%% OFFEROS-BODY-END" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.templates.update).toHaveBeenCalledWith("t1", {
        name: "renamed letter",
        kind: t1.kind,
        renderer: t1.renderer,
        content: "%% OFFEROS-BODY-START\nnew body\n%% OFFEROS-BODY-END",
        scaffoldHints: "new hints",
        isDefault: true,
      }),
    );
    expect(await screen.findByText("renamed letter")).toBeTruthy();
  });

  it("deletes a template after an inline confirm", async () => {
    vi.mocked(api.templates.list).mockResolvedValue([t1]);
    render(<TemplatesClient />);

    fireEvent.click(await screen.findByLabelText("Delete averatec cover letter"));
    fireEvent.click(screen.getByText("Confirm"));

    await waitFor(() => expect(api.templates.remove).toHaveBeenCalledWith("t1"));
    expect(screen.queryByText("averatec cover letter")).toBeNull();
  });

  it("uploads a .tex file, analyzes it, and opens the confirm panel with the returned content", async () => {
    vi.mocked(api.templates.list).mockResolvedValue([]);
    vi.mocked(api.templates.analyze).mockResolvedValue({
      contentWithMarkers: "\\documentclass{letter}\n%% OFFEROS-BODY-START\n%% OFFEROS-BODY-END",
      bodyPreview: "",
      scaffoldHints: "Salutation: Dear Team",
      detected: true,
      warnings: [],
    });

    render(<TemplatesClient />);
    await screen.findByText(/no templates/i);

    const file = new File(["\\documentclass{letter}"], "my-letter.tex", { type: "text/x-tex" });
    const input = screen.getByLabelText(/upload .tex/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(api.templates.analyze).toHaveBeenCalled());
    const call = vi.mocked(api.templates.analyze).mock.calls[0]![0];
    expect(call.content).toBe("\\documentclass{letter}");
    expect(call.filename).toBe("my-letter.tex");

    // name derived from filename (extension stripped), content is contentWithMarkers
    expect((await screen.findByLabelText("Name")) as HTMLInputElement).toHaveProperty(
      "value",
      "my-letter",
    );
    expect((screen.getByLabelText("Content") as HTMLTextAreaElement).value).toContain(
      "\\documentclass{letter}",
    );
    expect((screen.getByLabelText("Scaffold hints") as HTMLInputElement).value).toBe(
      "Salutation: Dear Team",
    );
  });

  it("warns prominently when analyze could not detect the body region", async () => {
    vi.mocked(api.templates.list).mockResolvedValue([]);
    vi.mocked(api.templates.analyze).mockResolvedValue({
      contentWithMarkers: "\\documentclass{letter}",
      bodyPreview: "",
      scaffoldHints: "",
      detected: false,
      warnings: ["Couldn't find a body region"],
    });

    render(<TemplatesClient />);
    await screen.findByText(/no templates/i);

    const file = new File(["\\documentclass{letter}"], "raw.tex", { type: "text/x-tex" });
    fireEvent.change(screen.getByLabelText(/upload .tex/i), { target: { files: [file] } });

    expect(await screen.findByText(/couldn't find a body region/i)).toBeTruthy();
    expect(screen.getByText(/mark the ai-editable section/i)).toBeTruthy();
  });

  it("opens the confirm panel with builtin content and renderer when adding a built-in template", async () => {
    vi.mocked(api.templates.list).mockResolvedValue([]);

    render(<TemplatesClient />);
    await screen.findByText(/no templates/i);

    fireEvent.click(screen.getByRole("button", { name: /new built-in template/i }));

    const content = (await screen.findByLabelText("Content")) as HTMLTextAreaElement;
    expect(content.value).toContain("%% OFFEROS-BODY-START");
    expect(content.value).toContain("Dear Hiring Team,");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Built-in cover letter");
    // renderer badge in the confirm panel
    expect(screen.getByText("builtin")).toBeTruthy();
  });

  it("saves a new built-in template via api.templates.save", async () => {
    vi.mocked(api.templates.list).mockResolvedValue([]);
    vi.mocked(api.templates.save).mockResolvedValue({
      ...t2,
      id: "t3",
      name: "Built-in cover letter",
    });

    render(<TemplatesClient />);
    await screen.findByText(/no templates/i);

    fireEvent.click(screen.getByRole("button", { name: /new built-in template/i }));
    await screen.findByLabelText("Content");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.templates.save).toHaveBeenCalled());
    const payload = vi.mocked(api.templates.save).mock.calls[0]![0];
    expect(payload.renderer).toBe("builtin");
    expect(payload.name).toBe("Built-in cover letter");
    expect(payload.content).toContain("%% OFFEROS-BODY-START");
    expect(await screen.findByText("Built-in cover letter")).toBeTruthy();
  });

  it("previews the editable content and renders a PDF iframe from a blob URL", async () => {
    const { createObjectURL } = stubObjectUrl();
    vi.mocked(api.templates.list).mockResolvedValue([]);
    vi.mocked(api.templates.preview).mockResolvedValue({
      ok: true,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }),
    });

    render(<TemplatesClient />);
    await screen.findByText(/no templates/i);

    fireEvent.click(screen.getByRole("button", { name: /new built-in template/i }));
    await screen.findByLabelText("Content");
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() => expect(api.templates.preview).toHaveBeenCalled());
    const arg = vi.mocked(api.templates.preview).mock.calls[0]![0];
    expect(arg).toMatchObject({ renderer: "builtin" });

    const iframe = (await screen.findByTitle(/template preview/i)) as HTMLIFrameElement;
    expect(iframe.src).toBe("blob:mock-url");
    expect(createObjectURL).toHaveBeenCalled();
  });

  it("previews a saved template by id from its row action", async () => {
    stubObjectUrl();
    vi.mocked(api.templates.list).mockResolvedValue([t1]);
    vi.mocked(api.templates.preview).mockResolvedValue({
      ok: true,
      blob: new Blob([new Uint8Array([1])], { type: "application/pdf" }),
    });

    render(<TemplatesClient />);
    fireEvent.click(await screen.findByLabelText("Preview averatec cover letter"));

    await waitFor(() => expect(api.templates.preview).toHaveBeenCalledWith({ id: "t1" }));
    expect(await screen.findByTitle(/template preview/i)).toBeTruthy();
  });

  it("shows an enveloped preview error with expandable log details", async () => {
    stubObjectUrl();
    vi.mocked(api.templates.list).mockResolvedValue([t1]);
    vi.mocked(api.templates.preview).mockResolvedValue({
      ok: false,
      error: "pdflatex failed to compile the template",
      logExcerpt: "! Undefined control sequence.\nl.42 \\foo",
    });

    render(<TemplatesClient />);
    fireEvent.click(await screen.findByLabelText("Preview averatec cover letter"));

    await waitFor(() =>
      expect(screen.getByText("pdflatex failed to compile the template")).toBeTruthy(),
    );
    expect(screen.queryByText(/Undefined control sequence/)).toBeNull();

    fireEvent.click(screen.getByText(/Show details/i));
    expect(screen.getByText(/Undefined control sequence/)).toBeTruthy();
  });
});
