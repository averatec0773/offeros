import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BODY_START, BODY_END, extractBodyRegion } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import {
  ServiceError,
  analyzeTemplate,
  deleteTemplate,
  detectBodyRegion,
  listTemplates,
  saveTemplate,
} from "../template-service";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-template-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// --- Synthetic fixtures (no real personal content) --------------------------

// Mimics the structure of the real cover_letters/coverletter.tex: an `article`
// class with a sender block, a `Dear …` salutation, several body paragraphs, a
// trailing "Thank you …" sentence (the closing-word trap), a `\vspace` spacer,
// and a `Sincerely` valediction.
const ARTICLE_TEX = `\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{url}
\\input{glyphtounicode}

\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{1em}

\\begin{document}

Firstname Lastname \\\\
first.last@example.com \\\\
+1 (555) 000-0000

\\today
\\vspace{1em}

Dear Hiring Team,

First body paragraph introduces the applicant and states interest in the role.

Second body paragraph describes relevant experience and concrete projects.

Thank you for your time and consideration.

\\vspace{2em}
Sincerely, \\\\
Firstname Lastname

\\end{document}
`;

// A `letter`-class variant using \opening{…}/\closing{…}.
const LETTER_TEX = `\\documentclass{letter}
\\usepackage{url}
\\signature{Firstname Lastname}

\\begin{document}
\\begin{letter}{Hiring Team \\\\ Example Corp}

\\opening{Dear Hiring Team,}

First paragraph of the letter body describing the applicant's background.

Second paragraph with specifics about the position and why it is a good fit.

\\closing{Sincerely,}

\\end{letter}
\\end{document}
`;

describe("detectBodyRegion", () => {
  it("finds the body between salutation and Sincerely in an article letter", () => {
    const region = detectBodyRegion(ARTICLE_TEX);
    expect(region).not.toBeNull();
    const body = ARTICLE_TEX.slice(region!.start, region!.end);
    expect(body).toContain("First body paragraph");
    expect(body).toContain("Second body paragraph");
    // The "Thank you …" trailing sentence is body, not the closing.
    expect(body).toContain("Thank you for your time");
    // Scaffold stays out of the region.
    expect(body).not.toContain("Dear Hiring Team");
    expect(body).not.toContain("Sincerely");
    expect(body).not.toContain("\\vspace{2em}");
  });

  it("finds the body between \\opening and \\closing in a letter-class file", () => {
    const region = detectBodyRegion(LETTER_TEX);
    expect(region).not.toBeNull();
    const body = LETTER_TEX.slice(region!.start, region!.end);
    expect(body).toContain("First paragraph of the letter body");
    expect(body).toContain("Second paragraph with specifics");
    expect(body).not.toContain("\\opening");
    expect(body).not.toContain("\\closing");
  });

  it("returns null when there is no salutation/closing to anchor on", () => {
    expect(
      detectBodyRegion("\\documentclass{article}\n\\begin{document}\nJust text.\n\\end{document}"),
    ).toBeNull();
  });

  it("produces a region that round-trips through inject/extract markers", () => {
    const region = detectBodyRegion(ARTICLE_TEX)!;
    const before = ARTICLE_TEX.slice(0, region.start);
    const body = ARTICLE_TEX.slice(region.start, region.end);
    const after = ARTICLE_TEX.slice(region.end);
    const withMarkers = `${before}${BODY_START}\n${body}\n${BODY_END}${after}`;
    const extracted = extractBodyRegion(withMarkers);
    expect(extracted).toContain("First body paragraph");
    expect(extracted).toContain("Thank you for your time");
  });
});

describe("template CRUD + single-default invariant", () => {
  const base = { kind: "cover-letter", renderer: "latex", content: "hello" };

  it("creates, lists, updates and deletes", () => {
    expect(listTemplates(db)).toEqual([]);
    const a = saveTemplate(db, { ...base, name: "A" });
    expect(a.id).toBeTruthy();
    expect(a.createdAt).toBe(a.updatedAt);
    expect(listTemplates(db)).toHaveLength(1);

    const updated = saveTemplate(db, { ...base, id: a.id, name: "A2", content: "changed" });
    expect(updated.id).toBe(a.id);
    expect(updated.name).toBe("A2");
    expect(updated.content).toBe("changed");
    expect(updated.createdAt).toBe(a.createdAt);
    expect(listTemplates(db)).toHaveLength(1);

    deleteTemplate(db, a.id);
    expect(listTemplates(db)).toEqual([]);
  });

  it("rejects unknown kind and renderer", () => {
    expect(() => saveTemplate(db, { ...base, name: "X", kind: "resume" })).toThrow(ServiceError);
    expect(() => saveTemplate(db, { ...base, name: "X", renderer: "pdf" })).toThrow(ServiceError);
  });

  it("keeps exactly one default per kind", () => {
    const a = saveTemplate(db, { ...base, name: "A", isDefault: true });
    const b = saveTemplate(db, { ...base, name: "B", isDefault: true });
    const rows = listTemplates(db);
    expect(rows.find((t) => t.id === a.id)!.isDefault).toBe(false);
    expect(rows.find((t) => t.id === b.id)!.isDefault).toBe(true);
    expect(rows.filter((t) => t.isDefault)).toHaveLength(1);
  });
});

describe("analyzeTemplate", () => {
  it("detects the body, wraps it in markers, and derives hints for an article letter", () => {
    const result = analyzeTemplate(ARTICLE_TEX);
    expect(result.detected).toBe(true);
    // Markers wrap the detected region, and the rest of the file is preserved.
    expect(result.contentWithMarkers).toContain(BODY_START);
    expect(result.contentWithMarkers).toContain(BODY_END);
    expect(result.contentWithMarkers).toContain("Dear Hiring Team,");
    expect(result.contentWithMarkers).toContain("Sincerely");
    // The wrapped region round-trips back through the marker extractor.
    const extracted = extractBodyRegion(result.contentWithMarkers);
    expect(extracted).toContain("First body paragraph");
    expect(extracted).toContain("Thank you for your time");
    expect(extracted).not.toContain("Dear Hiring Team");
    // bodyPreview is the detected region.
    expect(result.bodyPreview).toContain("First body paragraph");
    expect(result.bodyPreview).not.toContain("Sincerely");
    // Hints describe salutation + closing.
    expect(result.scaffoldHints).toContain("Salutation");
    expect(result.scaffoldHints).toContain("Sincerely");
    expect(result.warnings).toEqual([]);
  });

  it("detects the body of a \\opening/\\closing letter-class file", () => {
    const result = analyzeTemplate(LETTER_TEX);
    expect(result.detected).toBe(true);
    expect(result.contentWithMarkers).toContain(BODY_START);
    expect(extractBodyRegion(result.contentWithMarkers)).toContain(
      "First paragraph of the letter body",
    );
  });

  it("returns detected:false with content unchanged and a warning when nothing anchors (never throws)", () => {
    const plain =
      "\\documentclass{article}\n\\begin{document}\nJust body text, no salutation.\n\\end{document}";
    let result!: ReturnType<typeof analyzeTemplate>;
    expect(() => {
      result = analyzeTemplate(plain);
    }).not.toThrow();
    expect(result.detected).toBe(false);
    expect(result.contentWithMarkers).toBe(plain); // byte-identical, no markers inserted
    expect(result.bodyPreview).toBe("");
    expect(result.scaffoldHints).toBe("");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("manually");
  });

  it("does not throw on empty content", () => {
    const result = analyzeTemplate("");
    expect(result.detected).toBe(false);
    expect(result.contentWithMarkers).toBe("");
  });
});
