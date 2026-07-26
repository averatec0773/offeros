import { randomUUID } from "node:crypto";
import {
  BODY_START,
  BODY_END,
  TEMPLATE_KINDS,
  TEMPLATE_RENDERERS,
  templateSchema,
  type Template,
} from "@offeros/core";
import type { Db } from "../db/client";
import {
  clearDefaultForKind,
  deleteTemplateRow,
  listTemplates as listTemplateRows,
  upsertTemplate,
} from "../repositories/template-repo";

/**
 * A caller-facing precondition failure (unknown kind/renderer). Matched by
 * `error.name` in the http envelope, so it maps to a 400 while genuine bugs
 * stay 500.
 */
export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

// -- CRUD --------------------------------------------------------------------

export function listTemplates(db: Db): Template[] {
  return listTemplateRows(db);
}

export interface SaveTemplateInput {
  id?: string;
  name: string;
  kind: string;
  renderer: string;
  content: string;
  scaffoldHints?: string;
  isDefault?: boolean;
}

/** Create or update a template. `isDefault:true` clears the default flag on
 *  every other template of the same kind (single-default invariant). */
export function saveTemplate(db: Db, input: SaveTemplateInput): Template {
  if (!(TEMPLATE_KINDS as readonly string[]).includes(input.kind)) {
    throw new ServiceError(`unknown template kind: ${input.kind}`);
  }
  if (!(TEMPLATE_RENDERERS as readonly string[]).includes(input.renderer)) {
    throw new ServiceError(`unknown template renderer: ${input.renderer}`);
  }

  const now = Date.now();
  const existing = input.id ? listTemplateRows(db).find((t) => t.id === input.id) : undefined;
  const id = existing?.id ?? input.id ?? randomUUID();

  const doc = templateSchema.parse({
    id,
    name: input.name,
    kind: input.kind,
    renderer: input.renderer,
    content: input.content,
    scaffoldHints: input.scaffoldHints ?? existing?.scaffoldHints ?? "",
    isDefault: input.isDefault ?? existing?.isDefault ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  const saved = upsertTemplate(db, doc);
  if (saved.isDefault) clearDefaultForKind(db, saved.kind, saved.id);
  return saved;
}

export function deleteTemplate(db: Db, id: string): void {
  deleteTemplateRow(db, id);
}

// -- Body-region detection ---------------------------------------------------

const SALUTATION_RE = /^\s*(dear|to whom|hello|hi|greetings)\b/i;
// Strong valedictions — canonical letter closings.
const CLOSING_RE =
  /^\s*(sincerely|regards|best regards|best wishes|best|yours (sincerely|truly|faithfully)|kind regards|warm regards|respectfully|cordially|yours)\b/i;
// Weak fallback — only used when no strong closing exists.
const WEAK_CLOSING_RE = /^\s*(thank you|thanks)\b/i;
// Lines that are pure vertical-spacing scaffold, kept OUT of the body region.
const SPACING_RE =
  /^\s*\\(vspace|vskip|bigskip|medskip|smallskip|par|newline)\b\s*(\{[^}]*\})?\s*$/;

interface Lines {
  text: string[];
  /** Character offset at the start of each line (offset[i] = start of line i). */
  offset: number[];
}

function splitLines(tex: string): Lines {
  const text = tex.split("\n");
  const offset: number[] = [];
  let acc = 0;
  for (const line of text) {
    offset.push(acc);
    acc += line.length + 1; // +1 for the "\n" that split removed
  }
  return { text, offset };
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/** Walk backward from `end` (exclusive) over blank + spacing-only lines,
 *  returning the index of the first content line above the run + 1. */
function trimTrailingScaffold(lines: Lines, end: number): number {
  let i = end - 1;
  while (i >= 0) {
    const line = lines.text[i] ?? "";
    if (!isBlank(line) && !SPACING_RE.test(line)) break;
    i--;
  }
  return i + 1;
}

/** Walk forward from `start` over blank lines, returning the first non-blank. */
function skipLeadingBlanks(lines: Lines, start: number): number {
  let i = start;
  while (i < lines.text.length && isBlank(lines.text[i] ?? "")) i++;
  return i;
}

/** Offset just past the end of line `i` (i.e. the trailing newline position). */
function lineEndOffset(lines: Lines, i: number): number {
  return (lines.offset[i] ?? 0) + (lines.text[i] ?? "").length;
}

function matchBrace(tex: string, openIdx: number): number {
  // openIdx points at the "{"; returns index of the matching "}", or -1.
  let depth = 0;
  for (let i = openIdx; i < tex.length; i++) {
    if (tex[i] === "{") depth++;
    else if (tex[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Locate the letter-body character range `[start, end)` in a LaTeX cover-letter.
 *
 * Heuristic, in order:
 *  1. **Letter class** — if `\opening{…}` and `\closing` are present, the body
 *     is everything after the `\opening{…}` group up to the `\closing` line.
 *  2. **Plain (article) letter** — the body is the block between the salutation
 *     line (`Dear …`, `Hello …`, `To whom …`) and the closing valediction
 *     (`Sincerely`, `Regards`, …). A strong valediction is preferred so a body
 *     paragraph that merely opens with "Thank you" is not mistaken for the
 *     close; the weak "Thank you/Thanks" pattern is only used as a last resort.
 *
 * Trailing/leading blank and vertical-spacing lines (`\vspace`, `\bigskip`, …)
 * are excluded so the returned range covers only replaceable prose. Returns
 * null when no plausible salutation+closing pair is found.
 */
export function detectBodyRegion(tex: string): { start: number; end: number } | null {
  const lines = splitLines(tex);

  // 1. Letter class via \opening{…} / \closing.
  const openingIdx = tex.indexOf("\\opening");
  if (openingIdx !== -1) {
    const braceIdx = tex.indexOf("{", openingIdx);
    if (braceIdx !== -1) {
      const closeBrace = matchBrace(tex, braceIdx);
      const closingIdx = tex.indexOf("\\closing", closeBrace === -1 ? braceIdx : closeBrace);
      if (closeBrace !== -1 && closingIdx !== -1) {
        let start = closeBrace + 1;
        while (start < tex.length && (tex[start] === "\n" || tex[start] === " ")) start++;
        // Pull the end back over spacing lines preceding \closing.
        const closingLine = lineForOffset(lines, closingIdx);
        const endLine = trimTrailingScaffold(lines, closingLine);
        const end = endLine > 0 ? lineEndOffset(lines, endLine - 1) : closingIdx;
        if (end > start) return { start, end };
      }
    }
  }

  // 2. Plain article letter: salutation … valediction.
  const docStart = findLine(lines, (l) => l.includes("\\begin{document}"));
  const searchFrom = docStart === -1 ? 0 : docStart + 1;

  const salLine = findLine(lines, (l) => SALUTATION_RE.test(l), searchFrom);
  if (salLine === -1) return null;

  let closeLine = findLine(lines, (l) => CLOSING_RE.test(l), salLine + 1);
  if (closeLine === -1) closeLine = findLine(lines, (l) => WEAK_CLOSING_RE.test(l), salLine + 1);
  if (closeLine === -1) {
    // No valediction — fall back to \end{document} as the lower bound.
    closeLine = findLine(lines, (l) => l.includes("\\end{document}"), salLine + 1);
    if (closeLine === -1) return null;
  }

  const startLine = skipLeadingBlanks(lines, salLine + 1);
  const endLine = trimTrailingScaffold(lines, closeLine);
  if (startLine >= endLine) return null;

  const start = lines.offset[startLine] ?? 0;
  const end = lineEndOffset(lines, endLine - 1);
  if (end <= start) return null;
  return { start, end };
}

function findLine(lines: Lines, pred: (line: string) => boolean, from = 0): number {
  for (let i = from; i < lines.text.length; i++) if (pred(lines.text[i] ?? "")) return i;
  return -1;
}

function lineForOffset(lines: Lines, offset: number): number {
  for (let i = lines.text.length - 1; i >= 0; i--) if ((lines.offset[i] ?? 0) <= offset) return i;
  return 0;
}

/** Wrap the detected body region with BODY markers, preserving every other byte. */
function insertBodyMarkers(tex: string, region: { start: number; end: number }): string {
  const before = tex.slice(0, region.start);
  const body = tex.slice(region.start, region.end);
  const after = tex.slice(region.end);
  return `${before}${BODY_START}\n${body}\n${BODY_END}${after}`;
}

// -- scaffoldHints -----------------------------------------------------------

/** A short, honest plain-text description of the fixed scaffold, later fed to
 *  the generation prompt. Reports salutation, closing, and body paragraph count
 *  where they can be inferred from the source. */
function deriveScaffoldHints(tex: string, region: { start: number; end: number }): string {
  const lines = splitLines(tex);
  const salLine = findLine(lines, (l) => SALUTATION_RE.test(l));
  const from = salLine === -1 ? 0 : salLine + 1;
  let closeLine = findLine(lines, (l) => CLOSING_RE.test(l), from);
  if (closeLine === -1) closeLine = findLine(lines, (l) => WEAK_CLOSING_RE.test(l), from);

  const parts: string[] = [];
  if (salLine !== -1) parts.push(`Salutation: "${cleanTexLine(lines.text[salLine] ?? "")}".`);
  if (closeLine !== -1) parts.push(`Closing: "${cleanTexLine(lines.text[closeLine] ?? "")}".`);

  const body = tex.slice(region.start, region.end);
  const paras = body.split(/\n\s*\n/).filter((p) => p.trim() !== "").length;
  if (paras > 0) parts.push(`Body: ${paras} paragraph${paras === 1 ? "" : "s"}.`);

  return parts.join(" ");
}

/** Strip trailing `\\`, `\vspace{…}` and surrounding whitespace for a hint line. */
function cleanTexLine(line: string): string {
  return line
    .replace(/\\vspace\{[^}]*\}/g, "")
    .replace(/\\\\/g, "")
    .trim();
}

// -- Analyze -----------------------------------------------------------------

export interface AnalyzeTemplateResult {
  /** `content` with BODY markers wrapped around the detected region, or the
   *  unchanged input when no region could be detected. */
  contentWithMarkers: string;
  /** The detected body text, or "" when nothing was detected. */
  bodyPreview: string;
  /** Derived salutation/closing/paragraph hints, or "" when nothing inferable. */
  scaffoldHints: string;
  detected: boolean;
  warnings: string[];
}

/**
 * Inspect an uploaded cover-letter `.tex` (or any template content) WITHOUT
 * saving: detect the letter-body region, wrap it with BODY markers, and derive
 * scaffold hints. Purely functional — a pipeline seam for the upload→confirm
 * UI, so the user can review/adjust the auto-placed markers before saving.
 *
 * Never throws for undetectable input: when {@link detectBodyRegion} finds no
 * salutation/closing to anchor on, it returns the content unchanged with
 * `detected: false` and a warning asking the user to place the markers by hand.
 */
export function analyzeTemplate(content: string): AnalyzeTemplateResult {
  const region = detectBodyRegion(content);
  if (!region) {
    return {
      contentWithMarkers: content,
      bodyPreview: "",
      scaffoldHints: "",
      detected: false,
      warnings: [
        `Couldn't auto-detect the letter body — place the ${BODY_START} and ${BODY_END} markers manually around the body text.`,
      ],
    };
  }

  return {
    contentWithMarkers: insertBodyMarkers(content, region),
    bodyPreview: content.slice(region.start, region.end),
    scaffoldHints: deriveScaffoldHints(content, region),
    detected: true,
    warnings: [],
  };
}
