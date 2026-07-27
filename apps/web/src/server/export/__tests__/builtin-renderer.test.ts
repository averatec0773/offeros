import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Template } from "@offeros/core";
import { BODY_END, BODY_START } from "@offeros/core";
import { BUILTIN_STARTER } from "../builtin-starter";
import { buildHtml, renderBuiltin } from "../builtin-renderer";
import type { RenderInput } from "../renderers";

function builtinTemplate(content: string): Template {
  const now = Date.now();
  return {
    id: "tpl-builtin-1",
    name: "starter",
    kind: "cover-letter",
    renderer: "builtin",
    content,
    scaffoldHints: "",
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

/** True only when the Chromium browser is actually installed — without a local
 *  Chromium download (`npx playwright install chromium`) the real-render smoke
 *  skips rather than failing red. CI installs Chromium, so it runs there. */
async function chromiumInstalled(): Promise<boolean> {
  try {
    const { chromium } = await import("playwright");
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}
const HAS_CHROMIUM = await chromiumInstalled();

describe("buildHtml", () => {
  it("escapes body content and preserves paragraph structure", () => {
    const html = buildHtml({
      body: "First <b>para</b> & more.\n\nSecond para.",
      meta: { title: "Cover Letter", jobTitle: "GenAI Engineer", company: "Evolver" },
    });
    expect(html).toContain("&lt;b&gt;para&lt;/b&gt; &amp; more.");
    expect(html).not.toContain("<b>para</b>");
    expect(html).toContain("<p>First");
    expect(html).toContain("<p>Second para.</p>");
    expect(html).toContain("GenAI Engineer · Evolver");
  });

  it("omits the meta line when no job info is present", () => {
    const html = buildHtml({ body: "Body.", meta: { title: "Resume" } });
    expect(html).not.toContain('class="meta"');
  });
});

// Captured from `buildHtml` on the pre-refactor auto-layout code path — the
// no-template path (resumes always, cover-letter fallback) MUST stay
// byte-identical after the template-path refactor. Regression guard.
describe("buildHtml (no-template auto-layout — byte-identical regression guard)", () => {
  it("matches the captured pre-refactor output with full meta", () => {
    const html = buildHtml({
      body: "First para.\n\nSecond para with <tag> & stuff.",
      meta: { title: "Cover Letter", jobTitle: "GenAI Engineer", company: "Evolver" },
    });
    expect(html).toBe(
      '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>Cover Letter</title>\n<style>\n  html, body { margin: 0; padding: 0; }\n  body {\n    font-family: Georgia, "Times New Roman", "Noto Serif", serif;\n    color: #1a1a1a;\n    background: #ffffff;\n    font-size: 11.5pt;\n    line-height: 1.55;\n  }\n  h1 { font-size: 20pt; font-weight: 600; margin: 0 0 2pt; letter-spacing: -0.01em; }\n  .meta { font-size: 10.5pt; color: #555; margin-bottom: 18pt; }\n  p { margin: 0 0 11pt; white-space: normal; }\n</style>\n</head>\n<body>\n  <h1>Cover Letter</h1>\n  <div class="meta">GenAI Engineer · Evolver</div>\n  <p>First para.</p>\n<p>Second para with &lt;tag&gt; &amp; stuff.</p>\n</body>\n</html>',
    );
  });

  it("matches the captured pre-refactor output with no meta line", () => {
    const html = buildHtml({
      body: "Just one paragraph, no meta.",
      meta: { title: "Resume" },
    });
    expect(html).toBe(
      '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>Resume</title>\n<style>\n  html, body { margin: 0; padding: 0; }\n  body {\n    font-family: Georgia, "Times New Roman", "Noto Serif", serif;\n    color: #1a1a1a;\n    background: #ffffff;\n    font-size: 11.5pt;\n    line-height: 1.55;\n  }\n  h1 { font-size: 20pt; font-weight: 600; margin: 0 0 2pt; letter-spacing: -0.01em; }\n  .meta { font-size: 10.5pt; color: #555; margin-bottom: 18pt; }\n  p { margin: 0 0 11pt; white-space: normal; }\n</style>\n</head>\n<body>\n  <h1>Resume</h1>\n  \n  <p>Just one paragraph, no meta.</p>\n</body>\n</html>',
    );
  });

  it("keeps the no-template path even when a non-builtin (latex) template is passed", () => {
    const now = Date.now();
    const latexTemplate: Template = {
      id: "tpl-latex-1",
      name: "latex",
      kind: "cover-letter",
      renderer: "latex",
      content: "\\documentclass{article}",
      scaffoldHints: "",
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    };
    const html = buildHtml({
      body: "Body.",
      meta: { title: "Cover Letter" },
      template: latexTemplate,
    });
    expect(html).toContain("<h1>Cover Letter</h1>");
    expect(html).not.toContain("\\documentclass");
  });
});

describe("buildHtml (builtin template path)", () => {
  const scaffold = [
    "<p>Your Name</p>",
    "<p>Dear Hiring Team,</p>",
    BODY_START,
    "OLD BODY",
    BODY_END,
    "<p>Sincerely,<br>Your Name</p>",
  ].join("\n");

  it("injects the escaped, paragraph-wrapped body between the markers and keeps scaffold bytes outside", () => {
    const html = buildHtml({
      body: "First para.\n\nSecond para with <tag> & stuff.",
      meta: { title: "Cover Letter" },
      template: builtinTemplate(scaffold),
    });
    expect(html).toContain("<p>Your Name</p>");
    expect(html).toContain("<p>Dear Hiring Team,</p>");
    expect(html).toContain("<p>Sincerely,<br>Your Name</p>");
    expect(html).toContain("<p>First para.</p>");
    expect(html).toContain("<p>Second para with &lt;tag&gt; &amp; stuff.</p>");
    expect(html).not.toContain("OLD BODY");
    expect(html).not.toContain("<tag>");
    // Print CSS shared with the auto-layout path.
    expect(html).toContain("font-family: Georgia");
  });

  it("throws TemplateError-derived failure as ok:false (not a crash) via renderBuiltin when markers are missing", async () => {
    const noMarkers = "<p>Your Name</p><p>Dear Hiring Team,</p><p>Sincerely,</p>";
    expect(() =>
      buildHtml({
        body: "Body.",
        meta: { title: "Cover Letter" },
        template: builtinTemplate(noMarkers),
      }),
    ).toThrow();

    const result = await renderBuiltin({
      body: "Body.",
      meta: { title: "Cover Letter" },
      template: builtinTemplate(noMarkers),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/marker/i);
    }
  });
});

describe.skipIf(!HAS_CHROMIUM)("renderBuiltin (real chromium)", () => {
  it("renders valid PDF bytes", async () => {
    const input: RenderInput = {
      body: "Paragraph one of the résumé.\n\nParagraph two with a <tag> to escape.",
      meta: { title: "Resume", jobTitle: "Engineer", company: "Acme" },
    };
    const result = await renderBuiltin(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(result.pdf.byteLength).toBeGreaterThan(500);
    }
    // Generous ceiling: first chromium launch on a cold machine can be slow.
  }, 120_000);

  it("renders BUILTIN_STARTER wrapped around a sample body to a valid PDF", async () => {
    const result = await renderBuiltin({
      body: "Thank you for considering my application.\n\nI would love to discuss further.",
      meta: { title: "Cover Letter", jobTitle: "Engineer", company: "Acme" },
      template: builtinTemplate(BUILTIN_STARTER),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(result.pdf.byteLength).toBeGreaterThan(500);
    }
  }, 120_000);
});
