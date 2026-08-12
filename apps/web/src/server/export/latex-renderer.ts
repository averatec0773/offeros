import { execFileSync, spawn as nodeSpawn, type SpawnOptions } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectBody, TemplateError } from "@offeros/core";
import { defaultTemplatesDir } from "../db/client";
import type { RenderInput, RenderResult } from "./renderers";

/** Writable TeX cache the user's own workflow relies on; keeps pdflatex from
 *  failing on a read-only default TEXMFVAR under sandboxes. */
const DEFAULT_TEXMFVAR = "/private/tmp/texmf-var";
const JOB = "letter";

/** Minimal shape of `child_process.spawn` used here — lets tests inject a stub. */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface LatexOptions {
  /** Directory holding staged template assets (.cls, shared inputs). */
  templatesDir?: string;
  spawn?: SpawnFn;
  texmfVar?: string;
}

/**
 * Escape LaTeX special characters in plain-text body content. Order matters:
 * backslash MUST be handled first (before we introduce backslashes for the
 * other escapes), and `~` / `^` need `\text…{}` forms so they render as literal
 * characters rather than accents. Left unescaped, `%` silently truncates the
 * rest of its line (data loss) and `&` / `$` / `#` / `_` hard-fail the compile.
 *
 * Only the injected body is escaped, at the renderer layer — the template
 * scaffold is authored LaTeX and stays untouched, and core `injectBody` remains
 * format-agnostic.
 */
const LATEX_ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

export function escapeLatex(text: string): string {
  // Single pass so the braces we introduce (e.g. `\textbackslash{}`) are never
  // re-escaped by a later rule.
  return text.replace(/[\\&%$#_{}~^]/g, (ch) => LATEX_ESCAPES[ch] ?? ch);
}

// `undefined` = not yet probed, `null` = probed and absent, string = resolved path.
let pdflatexPathCache: string | null | undefined;

/** `which pdflatex`, probed once and cached in module state. */
export function hasPdflatex(): boolean {
  if (pdflatexPathCache === undefined) {
    try {
      pdflatexPathCache = execFileSync("which", ["pdflatex"], { encoding: "utf8" }).trim() || null;
    } catch {
      pdflatexPathCache = null;
    }
  }
  return pdflatexPathCache != null;
}

/**
 * Render a cover-letter template to PDF via pdflatex.
 *
 * The template body markers are replaced with `input.body` (`injectBody`), the
 * result is written into a fresh `mkdtemp` dir alongside COPIES of the staged
 * template assets (so `\documentclass{resume}` / `\input{…}` resolve), and
 * pdflatex is run with `-halt-on-error -interaction=nonstopmode`. On a non-zero
 * exit the tail of the `.log` is surfaced as `logExcerpt`. The temp dir is
 * always removed, on success and on failure alike.
 */
export async function renderLatex(
  input: RenderInput,
  opts: LatexOptions = {},
): Promise<RenderResult> {
  if (!input.template) {
    return { ok: false, error: "latex renderer requires a template" };
  }

  let tex: string;
  try {
    tex = injectBody(input.template.content, escapeLatex(input.body));
  } catch (error) {
    if (error instanceof TemplateError) {
      return {
        ok: false,
        error:
          "The cover-letter template is missing its body markers. " +
          "Restore them in Documents → Templates before exporting.",
      };
    }
    throw error;
  }

  const dir = mkdtempSync(join(tmpdir(), "offeros-latex-"));
  try {
    writeFileSync(join(dir, `${JOB}.tex`), tex, "utf8");
    stageAssets(opts.templatesDir ?? defaultTemplatesDir(), dir);

    const spawn = opts.spawn ?? (nodeSpawn as unknown as SpawnFn);
    const exitCode = await runPdflatex(spawn, dir, opts.texmfVar ?? DEFAULT_TEXMFVAR);

    const pdfPath = join(dir, `${JOB}.pdf`);
    if (exitCode === 0 && existsSync(pdfPath)) {
      return { ok: true, pdf: readFileSync(pdfPath) };
    }
    return {
      ok: false,
      error: `pdflatex exited with code ${exitCode}`,
      logExcerpt: readLogTail(join(dir, `${JOB}.log`)),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Copy every staged asset file into the temp compile dir. Directories skipped. */
function stageAssets(assetsDir: string, destDir: string): void {
  if (!existsSync(assetsDir)) return;
  for (const name of readdirSync(assetsDir)) {
    const src = join(assetsDir, name);
    try {
      if (statSync(src).isFile()) copyFileSync(src, join(destDir, name));
    } catch {
      // A missing/unreadable asset is not fatal — pdflatex will report if it
      // actually needed the file, and that surfaces via the log tail.
    }
  }
}

/** pdflatex compiles user-supplied input, so it gets the bare minimum it needs
 *  to run — never the parent environment, which holds provider API keys.
 *  `openin_any: "p"` (paranoid) additionally confines pdflatex's own file
 *  reads to the cwd/output tree, so a hostile `.tex` (`\input{/etc/passwd}`
 *  and the like) can't read arbitrary files off the local machine. */
function childEnv(texmfVar: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    // NODE_ENV is carried only because Next's ProcessEnv augmentation requires
    // it; it is not a secret and pdflatex ignores it.
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TEXMFVAR: texmfVar,
    openin_any: "p",
  };
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  return env;
}

function runPdflatex(spawn: SpawnFn, dir: string, texmfVar: string): Promise<number> {
  const args = [
    "-no-shell-escape",
    "-interaction=nonstopmode",
    "-halt-on-error",
    `-output-directory=${dir}`,
    `${JOB}.tex`,
  ];
  return new Promise<number>((resolve) => {
    const child = spawn("pdflatex", args, {
      cwd: dir,
      env: childEnv(texmfVar),
      stdio: "ignore",
    });
    child.on("error", () => resolve(-1));
    child.on("close", (code) => resolve(code ?? -1));
  });
}

function readLogTail(logPath: string, lines = 30): string | undefined {
  if (!existsSync(logPath)) return undefined;
  const log = readFileSync(logPath, "utf8").trimEnd().split("\n");
  return log.slice(-lines).join("\n");
}
