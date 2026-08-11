import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDb, type Db } from "../../db/client";
import { insertResumeRow, getResumeRow } from "../../repositories/resume-repo";
import { getResumeText } from "../resume-service";

// The synthetic fixture is gitignored (present locally, absent in CI). Gate on
// it so CI skips rather than fails — same pattern as the chromium/pdflatex tests.
const FIXTURE = resolve(__dirname, "../../../../../../test-fixtures/jordan-rivera-resume.pdf");
const hasFixture = existsSync(FIXTURE);

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-resume-extract-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!hasFixture)("getResumeText extracts a PDF server-side and backfills", () => {
  it("returns text for a résumé that had none, and stores it for next time", async () => {
    insertResumeRow(db, {
      id: "r1",
      name: "Jordan.pdf",
      mimeType: "application/pdf",
      isPrimary: true,
      targetRole: null,
      note: null,
      text: "", // never extracted
      filePath: FIXTURE,
      createdAt: Date.now(),
    });

    const text = await getResumeText(db, "r1");
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain("Jordan Rivera");
    // Backfilled: the row now carries the text, so a second read is instant.
    expect(getResumeRow(db, "r1")!.text).toBe(text);
  });

  it("returns the stored text without re-extracting when it already exists", async () => {
    insertResumeRow(db, {
      id: "r2",
      name: "x.pdf",
      mimeType: "application/pdf",
      isPrimary: true,
      targetRole: null,
      note: null,
      text: "already here",
      filePath: FIXTURE,
      createdAt: Date.now(),
    });
    expect(await getResumeText(db, "r2")).toBe("already here");
  });
});

describe("getResumeText is honest when there is nothing to extract", () => {
  it("returns empty string for a missing résumé or one with no file", async () => {
    expect(await getResumeText(db, "nope")).toBe("");
    insertResumeRow(db, {
      id: "r3",
      name: "nofile.pdf",
      mimeType: "application/pdf",
      isPrimary: true,
      targetRole: null,
      note: null,
      text: "",
      filePath: null,
      createdAt: Date.now(),
    });
    expect(await getResumeText(db, "r3")).toBe("");
  });
});
