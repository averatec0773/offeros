import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { BODY_START, BODY_END } from "@offeros/core";

const dir = mkdtempSync(join(tmpdir(), "offeros-preview-"));
process.env.OFFEROS_DB_PATH = join(dir, "preview.db");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const { getDb } = await import("@/server/db/client");
const { saveTemplate, listTemplates, deleteTemplate } =
  await import("@/server/services/template-service");
const latexRenderer = await import("@/server/export/latex-renderer");
const { previewTemplate, SAMPLE_BODY } = await import("@/server/services/export-service");

/** Chromium download present? (CI has the package but not the browser.) */
async function chromiumInstalled(): Promise<boolean> {
  try {
    const { chromium } = await import("playwright");
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}
const HAS_CHROMIUM = await chromiumInstalled();

// Synthetic builtin scaffold (HTML fragment with body markers) — no personal content.
const BUILTIN_TEMPLATE = [
  "<p>Your Name<br>your.email@example.com</p>",
  "<p>Dear Hiring Team,</p>",
  BODY_START,
  BODY_END,
  "<p>Sincerely,<br>Your Name</p>",
].join("\n");

// Synthetic latex scaffold with body markers — no personal content.
const LATEX_TEMPLATE = [
  "\\documentclass{article}",
  "\\begin{document}",
  "Dear Hiring Team,",
  "",
  BODY_START,
  "placeholder",
  BODY_END,
  "",
  "Sincerely,",
  "\\end{document}",
  "",
].join("\n");

function clearTemplates(): void {
  for (const t of listTemplates(getDb())) deleteTemplate(getDb(), t.id);
}

describe("SAMPLE_BODY", () => {
  it("is a fixed, safe three-paragraph placeholder", () => {
    expect(SAMPLE_BODY.split(/\n\s*\n/).filter((p) => p.trim() !== "")).toHaveLength(3);
  });
});

describe("previewTemplate (renderer selection)", () => {
  it("returns ok:false with a note for a latex template when pdflatex is absent", async () => {
    const spy = vi.spyOn(latexRenderer, "hasPdflatex").mockReturnValue(false);
    try {
      const result = await previewTemplate(getDb(), {
        content: LATEX_TEMPLATE,
        renderer: "latex",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/pdflatex/i);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns ok:false for an unknown template id", async () => {
    const result = await previewTemplate(getDb(), { id: "does-not-exist" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("does-not-exist");
  });
});

describe.skipIf(!HAS_CHROMIUM)("previewTemplate (builtin, real chromium)", () => {
  it("renders a builtin template to valid PDF bytes with SAMPLE_BODY", async () => {
    const result = await previewTemplate(getDb(), {
      content: BUILTIN_TEMPLATE,
      renderer: "builtin",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(result.pdf.byteLength).toBeGreaterThan(500);
    }
  }, 120_000);

  it("renders an existing saved template by id", async () => {
    clearTemplates();
    const saved = saveTemplate(getDb(), {
      name: "builtin preview",
      kind: "cover-letter",
      renderer: "builtin",
      content: BUILTIN_TEMPLATE,
    });
    const result = await previewTemplate(getDb(), { id: saved.id });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  }, 120_000);
});

describe.skipIf(!latexRenderer.hasPdflatex())("previewTemplate (latex, real pdflatex)", () => {
  it("compiles a latex template to valid PDF bytes with SAMPLE_BODY", async () => {
    const result = await previewTemplate(getDb(), {
      content: LATEX_TEMPLATE,
      renderer: "latex",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(result.pdf.byteLength).toBeGreaterThan(500);
    }
  }, 60_000);
});
