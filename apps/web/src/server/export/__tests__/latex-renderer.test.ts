import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Template } from "@offeros/core";
import { BODY_START, BODY_END } from "@offeros/core";
import { escapeLatex, hasPdflatex, renderLatex, type SpawnFn } from "../latex-renderer";
import type { RenderInput } from "../renderers";

const scratch = mkdtempSync(join(tmpdir(), "offeros-latex-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function template(content: string): Template {
  const now = Date.now();
  return {
    id: "tpl-1",
    name: "test",
    kind: "cover-letter",
    renderer: "latex",
    content,
    scaffoldHints: "",
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

const WITH_MARKERS = [
  "\\documentclass{article}",
  "\\begin{document}",
  "Dear Team,",
  BODY_START,
  "OLD BODY",
  BODY_END,
  "Sincerely, A",
  "\\end{document}",
].join("\n");

const input = (content: string): RenderInput => ({
  body: "Injected paragraph one.\n\nInjected paragraph two.",
  meta: { title: "Cover Letter" },
  template: template(content),
});

/** Records the args / output-dir it was called with, then drives `close`.
 *  `onSpawn` may write files (e.g. the .pdf or .log) into the output dir. */
function stubSpawn(opts: {
  exitCode: number;
  onSpawn?: (outputDir: string) => void;
  capture?: { args?: readonly string[]; dir?: string };
}): SpawnFn {
  return (_command, args) => {
    const child = new EventEmitter() as unknown as ReturnType<SpawnFn>;
    const dirArg = args.find((a) => a.startsWith("-output-directory="));
    const dir = dirArg ? dirArg.slice("-output-directory=".length) : "";
    if (opts.capture) {
      opts.capture.args = args;
      opts.capture.dir = dir;
    }
    opts.onSpawn?.(dir);
    // Fire asynchronously so the caller's promise handlers are attached first.
    setImmediate(() => child.emit("close", opts.exitCode));
    return child;
  };
}

describe("renderLatex (spawn stubbed)", () => {
  it("passes the expected pdflatex args and injects the body", () => {
    const capture: { args?: readonly string[]; dir?: string } = {};
    let writtenTex = "";
    const spawn = stubSpawn({
      exitCode: 0,
      capture,
      onSpawn: (dir) => {
        writtenTex = readFileSync(join(dir, "letter.tex"), "utf8");
        writeFileSync(join(dir, "letter.pdf"), "%PDF-1.4 stub\n");
      },
    });
    return renderLatex(input(WITH_MARKERS), { spawn, templatesDir: scratch }).then((result) => {
      expect(result.ok).toBe(true);
      expect(capture.args).toContain("-interaction=nonstopmode");
      expect(capture.args).toContain("-halt-on-error");
      expect(capture.args).toContain(`-output-directory=${capture.dir}`);
      expect(capture.args?.[capture.args.length - 1]).toBe("letter.tex");
      // injectBody replaced the region; scaffold lines preserved.
      expect(writtenTex).toContain("Injected paragraph one.");
      expect(writtenTex).toContain("Dear Team,");
      expect(writtenTex).not.toContain("OLD BODY");
    });
  });

  it("writes LaTeX-escaped body content into the .tex", async () => {
    let writtenTex = "";
    const spawn = stubSpawn({
      exitCode: 0,
      onSpawn: (dir) => {
        writtenTex = readFileSync(join(dir, "letter.tex"), "utf8");
        writeFileSync(join(dir, "letter.pdf"), "%PDF-1.4\n");
      },
    });
    const withSpecials: RenderInput = {
      body: "R&D drove 30% growth for $2M #1 c_x {y} 100% ~ ^ \\",
      meta: { title: "Cover Letter" },
      template: template(WITH_MARKERS),
    };
    await renderLatex(withSpecials, { spawn, templatesDir: scratch });
    expect(writtenTex).toContain("R\\&D drove 30\\% growth for \\$2M \\#1 c\\_x \\{y\\}");
    expect(writtenTex).toContain("\\textbackslash{}");
    expect(writtenTex).toContain("\\textasciitilde{}");
    expect(writtenTex).toContain("\\textasciicircum{}");
    // The body line itself carries no unescaped % that would truncate it.
    const bodyLine = writtenTex.split("\n").find((l) => l.startsWith("R\\&D")) ?? "";
    expect(bodyLine).not.toMatch(/(^|[^\\])%/);
  });

  it("removes the temp dir after success", async () => {
    const capture: { dir?: string } = {};
    const spawn = stubSpawn({
      exitCode: 0,
      capture,
      onSpawn: (dir) => writeFileSync(join(dir, "letter.pdf"), "%PDF-1.4\n"),
    });
    const result = await renderLatex(input(WITH_MARKERS), { spawn, templatesDir: scratch });
    expect(result.ok).toBe(true);
    expect(capture.dir).toBeTruthy();
    expect(existsSync(capture.dir!)).toBe(false);
  });

  it("returns logExcerpt and removes the temp dir on non-zero exit", async () => {
    const capture: { dir?: string } = {};
    const spawn = stubSpawn({
      exitCode: 1,
      capture,
      onSpawn: (dir) => {
        const log = Array.from({ length: 50 }, (_, i) => `log line ${i}`).join("\n");
        writeFileSync(join(dir, "letter.log"), `${log}\n! Emergency stop.\n`);
      },
    });
    const result = await renderLatex(input(WITH_MARKERS), { spawn, templatesDir: scratch });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("code 1");
      expect(result.logExcerpt).toContain("Emergency stop");
      // Only the tail is kept (~30 lines), not all 50 log lines.
      expect(result.logExcerpt).not.toContain("log line 0");
    }
    expect(existsSync(capture.dir!)).toBe(false);
  });

  it("returns a restore-the-markers error when the template lacks markers", async () => {
    const noMarkers = "\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}";
    let spawned = false;
    const spawn: SpawnFn = () => {
      spawned = true;
      return new EventEmitter() as unknown as ReturnType<SpawnFn>;
    };
    const result = await renderLatex(input(noMarkers), { spawn, templatesDir: scratch });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/body markers/i);
    expect(spawned).toBe(false);
  });

  it("errors without a template", async () => {
    const result = await renderLatex({
      body: "x",
      meta: { title: "Cover Letter" },
    });
    expect(result.ok).toBe(false);
  });
});

describe("escapeLatex", () => {
  it("escapes every LaTeX special without re-escaping introduced braces", () => {
    expect(escapeLatex("&%$#_{}")).toBe("\\&\\%\\$\\#\\_\\{\\}");
    expect(escapeLatex("a\\b")).toBe("a\\textbackslash{}b");
    expect(escapeLatex("~x^y")).toBe("\\textasciitilde{}x\\textasciicircum{}y");
    // The braces inside \textbackslash{} must NOT become \{ \}.
    expect(escapeLatex("\\")).toBe("\\textbackslash{}");
  });

  it("leaves ordinary prose untouched", () => {
    expect(escapeLatex("Plain sentence, no specials.")).toBe("Plain sentence, no specials.");
  });
});

// -- Real pdflatex compile (skipped where the binary is absent) ---------------

const MINIMAL_TEMPLATE = [
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

describe.skipIf(!hasPdflatex())("renderLatex (real pdflatex)", () => {
  it("compiles a minimal template to a valid PDF", async () => {
    const result = await renderLatex(
      {
        body: "This is the real injected cover-letter body.",
        meta: { title: "Cover Letter" },
        template: template(MINIMAL_TEMPLATE),
      },
      { templatesDir: scratch },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(result.pdf.byteLength).toBeGreaterThan(500);
    }
  }, 60_000);

  it("compiles a body containing LaTeX specials without data loss", async () => {
    // Unescaped, "%" truncates the line and "&"/"$" hard-fail — this proves the
    // renderer-layer escaping round-trips through a real compile.
    const result = await renderLatex(
      {
        body: "R&D drove 30% growth for $2M in Q1 #1; c_x {y} at ~100% ^ top.",
        meta: { title: "Cover Letter" },
        template: template(MINIMAL_TEMPLATE),
      },
      { templatesDir: scratch },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(result.pdf.byteLength).toBeGreaterThan(500);
    }
  }, 60_000);
});
