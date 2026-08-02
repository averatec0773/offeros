import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "../../db/client";
import { getStyleMemory, upsertStyleMemory, STYLE_MEMORY_MAX_CHARS } from "../style-memory-repo";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-style-memory-repo-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("style-memory repo", () => {
  it("returns null for a kind with no row yet", () => {
    expect(getStyleMemory(db, "resume")).toBeNull();
  });

  it("upsert creates a row, defaulting enabled to true", () => {
    const row = upsertStyleMemory(db, "resume", {
      notes: "- Prefers active voice.",
      sourceCount: 1,
    });
    expect(row.kind).toBe("resume");
    expect(row.notes).toBe("- Prefers active voice.");
    expect(row.enabled).toBe(true);
    expect(row.sourceCount).toBe(1);
    expect(typeof row.updatedAt).toBe("number");

    expect(getStyleMemory(db, "resume")).toEqual(row);
  });

  it("upsert on an existing row updates notes/sourceCount without resetting enabled to true", () => {
    upsertStyleMemory(db, "resume", { notes: "- First.", sourceCount: 1 });
    // Simulate the user disabling it (bypassing upsert, as the Style settings
    // page would via a direct enabled-only write) — upsert must not clobber it.
    db.run(sql`UPDATE style_memories SET enabled = 0 WHERE kind = 'resume'`);

    const updated = upsertStyleMemory(db, "resume", {
      notes: "- First.\n- Second.",
      sourceCount: 2,
    });
    expect(updated.notes).toBe("- First.\n- Second.");
    expect(updated.sourceCount).toBe(2);
    expect(updated.enabled).toBe(false); // untouched by the distill write
  });

  it("keeps resume and cover-letter memories independent", () => {
    upsertStyleMemory(db, "resume", { notes: "- Résumé preference.", sourceCount: 1 });
    upsertStyleMemory(db, "cover-letter", { notes: "- Letter preference.", sourceCount: 1 });

    expect(getStyleMemory(db, "resume")?.notes).toBe("- Résumé preference.");
    expect(getStyleMemory(db, "cover-letter")?.notes).toBe("- Letter preference.");
  });

  it("truncates notes defensively at the hard cap", () => {
    const overLong = "x".repeat(STYLE_MEMORY_MAX_CHARS + 500);
    const row = upsertStyleMemory(db, "resume", { notes: overLong, sourceCount: 1 });
    expect(row.notes).toHaveLength(STYLE_MEMORY_MAX_CHARS);
    expect(getStyleMemory(db, "resume")?.notes).toHaveLength(STYLE_MEMORY_MAX_CHARS);
  });

  it("does not truncate notes at or under the cap", () => {
    const exact = "y".repeat(STYLE_MEMORY_MAX_CHARS);
    const row = upsertStyleMemory(db, "resume", { notes: exact, sourceCount: 1 });
    expect(row.notes).toHaveLength(STYLE_MEMORY_MAX_CHARS);
  });
});
