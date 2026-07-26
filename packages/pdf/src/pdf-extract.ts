import * as pdfjs from "pdfjs-dist";

/**
 * Wire up pdf.js's worker. The worker script is bundler-specific (Vite's `?url`
 * import, Next's asset pipeline, etc.), so each host app resolves its own URL
 * and passes it in here once, before calling `extractPdfText`.
 */
export function configurePdfWorker(workerSrc: string): void {
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
}

export interface PositionedItem {
  str: string;
  /** Left edge x in PDF user space (transform[4]). */
  x: number;
  /** Baseline y in PDF user space (transform[5]); larger is higher on the page. */
  y: number;
  /** Advance width of the glyph run, same units as x. */
  width: number;
  height: number;
  hasEOL: boolean;
}

/**
 * Rebuild the resume's line structure from positioned text items. pdf.js yields
 * items in reading order and flags line ends with `hasEOL`; a clear downward
 * jump in baseline is a second line-break signal for PDFs where `hasEOL` is
 * unreliable. Lines are newline-joined so the parser keeps the cues it leans on
 * (the name on its own line, the contact line, section headers).
 *
 * Within a line, a space is inserted between two runs ONLY when their horizontal
 * positions show a real gap. pdf.js splits a word at ligature/kerning boundaries
 * ("Sofia" → "So"|"fi"|"a"), so blindly space-joining would corrupt names,
 * emails, and URLs — exactly the fields autofill depends on. Touching runs are
 * concatenated; only a gap wider than a fraction of the line height becomes a space.
 */
export function reconstructText(items: PositionedItem[]): string {
  const lines: string[] = [];
  let cur = "";
  let curEndX: number | null = null;
  let prevY: number | null = null;
  let prevHeight = 0;

  const flush = () => {
    if (cur.trim() !== "") lines.push(cur);
    cur = "";
    curEndX = null;
    prevY = null;
  };

  for (const it of items) {
    if (it.str === "") {
      if (it.hasEOL) flush();
      continue;
    }
    const lineHeight = it.height || prevHeight || 10;

    if (prevY !== null) {
      const drop = prevY - it.y; // positive => moved down the page
      if (drop > Math.max(2, lineHeight * 0.5)) flush();
    }
    if (cur !== "" && curEndX !== null) {
      const gap = it.x - curEndX;
      if (gap > Math.max(1, lineHeight * 0.2) && !cur.endsWith(" ") && !it.str.startsWith(" ")) {
        cur += " ";
      }
    }
    cur += it.str;
    curEndX = it.x + it.width;
    prevY = it.y;
    if (it.height) prevHeight = it.height;
    if (it.hasEOL) flush();
  }
  flush();

  return lines
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l !== "")
    .join("\n");
}

export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    // content.items is (TextItem | TextMarkedContent)[]; only TextItem carries `str`/`transform`.
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
}
