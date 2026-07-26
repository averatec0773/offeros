import { configurePdfWorker } from "@offeros/pdf";

/**
 * Point pdf.js at its worker script, resolved through Next's asset pipeline.
 * `new URL(..., import.meta.url)` is the bundler-agnostic idiom Turbopack (and
 * webpack) statically detect to emit the worker as a hashed asset and hand back
 * its final URL — so extraction runs off the main thread in the browser.
 *
 * Idempotent: the worker source is global to pdf.js, so wiring it more than once
 * is harmless but pointless. Call this once before the first `extractPdfText`.
 */
let configured = false;

export function ensurePdfWorker(): void {
  if (configured) return;
  configurePdfWorker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString());
  configured = true;
}
