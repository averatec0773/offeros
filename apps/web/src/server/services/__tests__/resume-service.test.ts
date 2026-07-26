import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../../db/client";
import {
  listResumes,
  uploadResume,
  setPrimaryResume,
  updateResume,
  deleteResume,
} from "../resume-service";
import { resumes } from "../../db/schema";

let db: Db;
let dir: string;
let storageDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-resume-service-"));
  db = createDb(join(dir, "t.db"));
  storageDir = join(dir, "resumes");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const PDF_BASE64 = Buffer.from("%PDF-1.4 fake resume bytes").toString("base64");

describe("uploadResume", () => {
  it("stores the file under storageDir and records a resume row", () => {
    const resume = uploadResume(
      db,
      { name: "My Resume.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 },
      { storageDir },
    );
    expect(resume.name).toBe("My Resume.pdf");
    expect(resume.mimeType).toBe("application/pdf");
    expect(resume.isPrimary).toBe(false);

    const row = db
      .select()
      .from(resumes)
      .all()
      .find((r) => r.id === resume.id);
    expect(row?.filePath).toBeTruthy();
    expect(existsSync(row!.filePath!)).toBe(true);
    expect(readFileSync(row!.filePath!, "utf8")).toBe("%PDF-1.4 fake resume bytes");
  });

  it("rejects a non-PDF mime type", () => {
    expect(() =>
      uploadResume(
        db,
        { name: "notes.txt", mimeType: "text/plain", dataBase64: PDF_BASE64 },
        { storageDir },
      ),
    ).toThrow();
    expect(listResumes(db)).toEqual([]);
  });

  it("rejects a payload over 10 MB decoded", () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1).toString("base64");
    expect(() =>
      uploadResume(
        db,
        { name: "big.pdf", mimeType: "application/pdf", dataBase64: big },
        { storageDir },
      ),
    ).toThrow();
    expect(listResumes(db)).toEqual([]);
  });

  it("never uses the client-supplied name for the file path, so a traversal-y name can't escape storageDir", () => {
    const resume = uploadResume(
      db,
      { name: "../../evil.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 },
      { storageDir },
    );
    const row = db
      .select()
      .from(resumes)
      .all()
      .find((r) => r.id === resume.id);
    const resolvedPath = resolve(row!.filePath!);
    expect(resolvedPath.startsWith(resolve(storageDir))).toBe(true);
    expect(readdirSync(storageDir)).toHaveLength(1);
    expect(readdirSync(dir)).not.toContain("evil.pdf");
  });

  it("stores and returns the extracted résumé text", () => {
    const resume = uploadResume(
      db,
      {
        name: "a.pdf",
        mimeType: "application/pdf",
        dataBase64: PDF_BASE64,
        text: "Jordan Rivera\nBackend engineer...",
      },
      { storageDir },
    );
    expect(resume.text).toBe("Jordan Rivera\nBackend engineer...");

    const reloaded = listResumes(db).find((r) => r.id === resume.id);
    expect(reloaded?.text).toBe("Jordan Rivera\nBackend engineer...");
  });

  it("defaults to an empty string when no text is provided", () => {
    const resume = uploadResume(
      db,
      { name: "a.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 },
      { storageDir },
    );
    expect(resume.text).toBe("");
  });

  it("reads a legacy row with no text column value as undefined", () => {
    const resume = uploadResume(
      db,
      { name: "a.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 },
      { storageDir },
    );
    // Simulates a row persisted before this column existed: `addColumnIfMissing`
    // leaves pre-existing rows NULL, not "".
    db.update(resumes).set({ text: null }).where(eq(resumes.id, resume.id)).run();

    const reloaded = listResumes(db).find((r) => r.id === resume.id);
    expect(reloaded?.text).toBeUndefined();
  });

  it("setting isPrimary on upload clears the flag on other resumes", () => {
    const first = uploadResume(
      db,
      { name: "a.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64, isPrimary: true },
      { storageDir },
    );
    expect(first.isPrimary).toBe(true);

    const second = uploadResume(
      db,
      { name: "b.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64, isPrimary: true },
      { storageDir },
    );
    expect(second.isPrimary).toBe(true);

    const all = listResumes(db);
    const firstAfter = all.find((r) => r.id === first.id);
    expect(firstAfter?.isPrimary).toBe(false);
  });
});

describe("setPrimaryResume", () => {
  it("clears the flag on all other resumes when set to true", () => {
    const a = uploadResume(
      db,
      { name: "a.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64, isPrimary: true },
      { storageDir },
    );
    const b = uploadResume(
      db,
      { name: "b.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 },
      { storageDir },
    );

    const updated = setPrimaryResume(db, b.id, true);
    expect(updated?.isPrimary).toBe(true);

    const all = listResumes(db);
    expect(all.find((r) => r.id === a.id)?.isPrimary).toBe(false);
    expect(all.find((r) => r.id === b.id)?.isPrimary).toBe(true);
  });

  it("returns null for a missing resume", () => {
    expect(setPrimaryResume(db, "does-not-exist", true)).toBeNull();
  });
});

describe("updateResume", () => {
  it("renames a resume and sets its note", () => {
    const r = uploadResume(
      db,
      { name: "a.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 },
      { storageDir },
    );
    const updated = updateResume(db, r.id, { name: "Backend.pdf", note: "For backend roles" });
    expect(updated?.name).toBe("Backend.pdf");
    expect(updated?.note).toBe("For backend roles");

    const reloaded = listResumes(db).find((x) => x.id === r.id);
    expect(reloaded?.name).toBe("Backend.pdf");
    expect(reloaded?.note).toBe("For backend roles");
  });

  it("leaves untouched fields alone when only one is patched", () => {
    const r = uploadResume(
      db,
      { name: "a.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 },
      { storageDir },
    );
    updateResume(db, r.id, { note: "note only" });
    const afterNote = listResumes(db).find((x) => x.id === r.id);
    expect(afterNote?.name).toBe("a.pdf");
    expect(afterNote?.note).toBe("note only");

    updateResume(db, r.id, { name: "renamed.pdf" });
    const afterName = listResumes(db).find((x) => x.id === r.id);
    expect(afterName?.name).toBe("renamed.pdf");
    expect(afterName?.note).toBe("note only");
  });

  it("toggling isPrimary keeps the single-primary invariant", () => {
    const a = uploadResume(
      db,
      { name: "a.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64, isPrimary: true },
      { storageDir },
    );
    const b = uploadResume(
      db,
      { name: "b.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 },
      { storageDir },
    );

    const updated = updateResume(db, b.id, { isPrimary: true });
    expect(updated?.isPrimary).toBe(true);

    const all = listResumes(db);
    expect(all.find((x) => x.id === a.id)?.isPrimary).toBe(false);
    expect(all.find((x) => x.id === b.id)?.isPrimary).toBe(true);
  });

  it("returns null for a missing resume", () => {
    expect(updateResume(db, "does-not-exist", { name: "x" })).toBeNull();
  });
});

describe("deleteResume", () => {
  it("removes the row and the file on disk", () => {
    const resume = uploadResume(
      db,
      { name: "a.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 },
      { storageDir },
    );
    const row = db
      .select()
      .from(resumes)
      .all()
      .find((r) => r.id === resume.id);
    expect(deleteResume(db, resume.id)).toBe(true);
    expect(listResumes(db)).toEqual([]);
    expect(existsSync(row!.filePath!)).toBe(false);
  });

  it("returns false for a missing resume", () => {
    expect(deleteResume(db, "does-not-exist")).toBe(false);
  });

  it("auto-promotes the newest remaining resume when deleting the primary", async () => {
    // Upload three resumes in sequence; the last one will be newest
    const first = uploadResume(
      db,
      { name: "a.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 },
      { storageDir },
    );
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = uploadResume(
      db,
      { name: "b.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 },
      { storageDir },
    );
    await new Promise((resolve) => setTimeout(resolve, 2));
    const third = uploadResume(
      db,
      { name: "c.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 },
      { storageDir },
    );

    // Make the first one primary
    setPrimaryResume(db, first.id, true);
    let all = listResumes(db);
    expect(all.find((r) => r.id === first.id)?.isPrimary).toBe(true);
    expect(all.find((r) => r.id === second.id)?.isPrimary).toBe(false);
    expect(all.find((r) => r.id === third.id)?.isPrimary).toBe(false);

    // Delete the primary; third (newest) should be promoted
    expect(deleteResume(db, first.id)).toBe(true);
    all = listResumes(db);
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.id === third.id)?.isPrimary).toBe(true);
    expect(all.find((r) => r.id === second.id)?.isPrimary).toBe(false);
    // Exactly one primary
    expect(all.filter((r) => r.isPrimary)).toHaveLength(1);
  });

  it("keeps primary unchanged when deleting a non-primary resume", () => {
    const first = uploadResume(
      db,
      { name: "a.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64, isPrimary: true },
      { storageDir },
    );
    const second = uploadResume(
      db,
      { name: "b.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 },
      { storageDir },
    );
    const third = uploadResume(
      db,
      { name: "c.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64 },
      { storageDir },
    );

    // Delete non-primary; primary should stay the same
    expect(deleteResume(db, second.id)).toBe(true);
    const all = listResumes(db);
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.id === first.id)?.isPrimary).toBe(true);
    expect(all.find((r) => r.id === third.id)?.isPrimary).toBe(false);
  });

  it("handles deleting the last resume (no auto-promotion needed)", () => {
    const resume = uploadResume(
      db,
      { name: "a.pdf", mimeType: "application/pdf", dataBase64: PDF_BASE64, isPrimary: true },
      { storageDir },
    );

    // Delete the only resume
    expect(deleteResume(db, resume.id)).toBe(true);
    const all = listResumes(db);
    expect(all).toHaveLength(0);
    // No resumes to promote
    expect(all.filter((r) => r.isPrimary)).toHaveLength(0);
  });
});
