import { injectBody, TemplateError } from "@offeros/core";
import type { RenderInput, RenderResult } from "./renderers";

/**
 * The built-in PDF path: a clean print-styled HTML document rendered by
 * headless Chromium (`page.pdf`). Two flavors of `buildHtml` output, chosen by
 * `input.template`:
 *
 *  - No template (or a non-builtin template, e.g. a latex template used as a
 *    fallback when pdflatex is absent) → the fixed auto-layout: title + job
 *    meta line + body. Used for resumes always, and as the cover-letter
 *    fallback.
 *  - `template.renderer === "builtin"` → the user's editable scaffold, with
 *    the body injected between its `@offeros/core` BODY_START/BODY_END
 *    markers via `injectBody`.
 *
 * Browser lifecycle: launch-per-call. A local-first single-user server renders a
 * PDF rarely and interactively; a shared long-lived Chromium would need a
 * shutdown hook and crash recovery for no measurable win at this cadence, so we
 * accept the ~0.5s launch cost and guarantee no leaked process instead.
 */
export async function renderBuiltin(input: RenderInput): Promise<RenderResult> {
  let html: string;
  try {
    html = buildHtml(input);
  } catch (error) {
    if (error instanceof TemplateError) {
      return {
        ok: false,
        error: `Your built-in template is missing the body markers — add both a "%% OFFEROS-BODY-START" and a "%% OFFEROS-BODY-END" line where the letter body should go. (${error.message})`,
      };
    }
    throw error;
  }

  let browser: Awaited<ReturnType<typeof import("playwright").chromium.launch>> | undefined;
  try {
    const { chromium } = await import("playwright");
    // Launch is inside the try so a missing browser/install surfaces as an
    // {ok:false} result (route → clean 400) instead of an unhandled throw.
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0.9in", bottom: "0.9in", left: "1in", right: "1in" },
    });
    return { ok: true, pdf: Buffer.from(pdf) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "builtin render failed" };
  } finally {
    await browser?.close();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Body → paragraphs on blank lines, hard line breaks preserved within each. */
function renderBody(body: string): string {
  const paragraphs = body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (paragraphs.length === 0) return "";
  return paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("\n");
}

/** Print CSS shared by both the auto-layout and builtin-template paths. */
const PRINT_STYLE = `
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Georgia, "Times New Roman", "Noto Serif", serif;
    color: #1a1a1a;
    background: #ffffff;
    font-size: 11.5pt;
    line-height: 1.55;
  }
  h1 { font-size: 20pt; font-weight: 600; margin: 0 0 2pt; letter-spacing: -0.01em; }
  .meta { font-size: 10.5pt; color: #555; margin-bottom: 18pt; }
  p { margin: 0 0 11pt; white-space: normal; }
`;

/** Wraps a `<body>` fragment with the shared `<html>`/`<head>`/print-CSS shell. */
function documentShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${PRINT_STYLE}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * Builds the render-ready HTML document. With `template.renderer ===
 * "builtin"`, injects the body into the user's scaffold (throws
 * `TemplateError` if it lacks body markers — the caller turns that into an
 * `{ok:false}` result). Otherwise, the fixed auto-layout — title, job meta,
 * body — unchanged from before templates existed.
 */
export function buildHtml(input: RenderInput): string {
  if (input.template?.renderer === "builtin") {
    const injected = injectBody(input.template.content, renderBody(input.body));
    return documentShell(input.meta.title, injected);
  }

  const { title, jobTitle, company } = input.meta;
  const metaLine = [jobTitle, company].filter((v) => v && v.trim() !== "").join(" · ");
  const metaHtml = metaLine ? `<div class="meta">${escapeHtml(metaLine)}</div>` : "";
  const bodyHtml = `  <h1>${escapeHtml(title)}</h1>\n  ${metaHtml}\n  ${renderBody(input.body)}`;
  return documentShell(title, bodyHtml);
}
