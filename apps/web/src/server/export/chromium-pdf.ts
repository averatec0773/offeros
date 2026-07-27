import type { LaunchOptions } from "playwright";
import type { RenderResult } from "./renderers";

/** Minimal HTML escaping shared by every chromium-backed renderer. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Chromium renders user/LLM-derived HTML (the builtin template path injects
 * the user's own template unsanitized — see `builtin-renderer.ts`), so like
 * pdflatex (`latex-renderer.ts`'s `childEnv`) it gets the bare minimum
 * environment it needs to launch — never the parent environment, which holds
 * provider API keys. `PATH`/`HOME` are what the packaged browser binary needs
 * to resolve and run; `TMPDIR` is carried through only when the parent env
 * sets one (matches `childEnv`'s treatment of the same variable).
 */
export function chromiumLaunchOptions(): LaunchOptions {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
  };
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  return { headless: true, env };
}

/**
 * Launch-per-call headless Chromium, print a ready-made HTML document to PDF,
 * and guarantee the browser is closed. Shared by every renderer that produces
 * a PDF via `page.pdf()` (builtin cover-letter/résumé auto-layout, structured
 * résumé) so the launch/print block exists exactly once.
 *
 * Browser lifecycle: launch-per-call. A local-first single-user server renders
 * a PDF rarely and interactively; a shared long-lived Chromium would need a
 * shutdown hook and crash recovery for no measurable win at this cadence, so we
 * accept the ~0.5s launch cost and guarantee no leaked process instead.
 */
export async function renderHtmlToPdf(html: string): Promise<RenderResult> {
  let browser: Awaited<ReturnType<typeof import("playwright").chromium.launch>> | undefined;
  try {
    const { chromium } = await import("playwright");
    // Launch is inside the try so a missing browser/install surfaces as an
    // {ok:false} result (route → clean 400) instead of an unhandled throw.
    browser = await chromium.launch(chromiumLaunchOptions());
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0.9in", bottom: "0.9in", left: "1in", right: "1in" },
    });
    return { ok: true, pdf: Buffer.from(pdf) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "chromium render failed" };
  } finally {
    await browser?.close();
  }
}
