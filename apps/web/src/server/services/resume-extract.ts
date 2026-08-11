import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { reconstructText, type PositionedItem } from "@offeros/pdf";

/**
 * Server-side résumé PDF → text.
 *
 * The onboarding flow extracts text in the BROWSER (pdf.js off the main
 * thread). But a résumé imported another way — or one whose extraction failed —
 * lands with empty `text`, and then the agent cannot read or analyse it. This
 * is the server-side counterpart: given the stored PDF path, extract the text
 * so it can be backfilled.
 *
 * pdf.js in Node needs its worker pointed at a real file. We use the `legacy`
 * build (the Node-friendly one) resolved from node_modules and loaded via a
 * runtime file: URL — kept fully dynamic and marked ignore so the Next bundler
 * does not try to trace pdf.js's worker into the server bundle. The good
 * line-structure rebuild (`reconstructText`) is shared with the client path.
 */

let pdfjsPromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;

/** Load the legacy pdf.js build once, worker wired to its file on disk. */
function loadPdfjs(): Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    const require = createRequire(import.meta.url);
    const pdfPath = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
    const workerPath = require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
    const pdfjs = (await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(pdfPath).href
    )) as typeof import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    return pdfjs;
  })();
  return pdfjsPromise;
}

/** Extract text from a PDF file at `filePath`. Returns "" on any failure — an
 *  unreadable or non-PDF file must never throw into a caller that treats
 *  "no text" as an ordinary state. */
export async function extractResumeTextFromFile(filePath: string): Promise<string> {
  try {
    const pdfjs = await loadPdfjs();
    const buf = await readFile(filePath);
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buf),
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.flatMap((it): PositionedItem[] =>
        "str" in it
          ? [
              {
                str: it.str,
                x: it.transform[4] ?? 0,
                y: it.transform[5] ?? 0,
                width: it.width ?? 0,
                height: it.height ?? 0,
                hasEOL: it.hasEOL ?? false,
              },
            ]
          : [],
      );
      pages.push(reconstructText(items));
    }
    return pages.join("\n\n").trim();
  } catch {
    return "";
  }
}
