import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createDb, type Db } from "../../db/client";
import { getStyleMemory } from "../../repositories/style-memory-repo";
import { styleMemory, styleMemoryRegistry } from "../style-memory";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-style-memory-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("style memory registry", () => {
  it("registers exactly one implementation, distilled-notes", () => {
    expect(Object.keys(styleMemoryRegistry)).toEqual(["distilled-notes"]);
    expect(styleMemory).toBe(styleMemoryRegistry["distilled-notes"]);
  });
});

describe("styleMemory.retrieve", () => {
  it("returns null when no row exists for the kind", () => {
    expect(styleMemory.retrieve(db, "resume")).toBeNull();
  });

  it("returns null when notes are empty even if a row exists", async () => {
    await styleMemory.distill(db, async () => ({ notes: "" }), "resume", {
      instructions: ["Make it punchier."],
      firstContent: "first",
      approvedContent: "approved",
    });
    expect(styleMemory.retrieve(db, "resume")).toBeNull();
  });

  it("returns the notes when enabled and non-empty", async () => {
    await styleMemory.distill(db, async () => ({ notes: "- Prefers active voice." }), "resume", {
      instructions: ["Make it punchier."],
      firstContent: "first",
      approvedContent: "approved",
    });
    expect(styleMemory.retrieve(db, "resume")).toBe("- Prefers active voice.");
  });

  it("returns null when the memory has been disabled", async () => {
    await styleMemory.distill(db, async () => ({ notes: "- Prefers active voice." }), "resume", {
      instructions: ["Make it punchier."],
      firstContent: "first",
      approvedContent: "approved",
    });
    // Disable directly at the row level (Settings → Style's job, not this task's).
    db.run(sql`UPDATE style_memories SET enabled = 0 WHERE kind = 'resume'`);

    expect(styleMemory.retrieve(db, "resume")).toBeNull();
  });

  it("keeps resume and cover-letter retrieval independent", async () => {
    await styleMemory.distill(db, async () => ({ notes: "- Résumé note." }), "resume", {
      instructions: ["x"],
      firstContent: "f",
      approvedContent: "a",
    });
    expect(styleMemory.retrieve(db, "cover-letter")).toBeNull();
    expect(styleMemory.retrieve(db, "resume")).toBe("- Résumé note.");
  });
});

describe("styleMemory.distill", () => {
  it("passes existingNotes, instructions, firstContent, approvedContent, and the maxChars cap to the runLlm task", async () => {
    let captured: unknown;
    const runLlm = async (taskId: string, input: unknown) => {
      expect(taskId).toBe("style-distill");
      captured = input;
      return { notes: "- Learned preference." };
    };
    await styleMemory.distill(db, runLlm, "resume", {
      instructions: ["Make it punchier.", "Cut the jargon."],
      firstContent: "first draft",
      approvedContent: "approved draft",
    });
    expect(captured).toMatchObject({
      existingNotes: "",
      instructions: ["Make it punchier.", "Cut the jargon."],
      firstContent: "first draft",
      approvedContent: "approved draft",
    });
    expect((captured as { maxChars: number }).maxChars).toBeGreaterThan(0);
  });

  it("feeds the existing notes back in on a second distill so the LLM can merge/dedupe", async () => {
    await styleMemory.distill(db, async () => ({ notes: "- First round." }), "resume", {
      instructions: ["a"],
      firstContent: "f",
      approvedContent: "a",
    });

    let secondExistingNotes: string | undefined;
    await styleMemory.distill(
      db,
      async (_id, input) => {
        secondExistingNotes = (input as { existingNotes: string }).existingNotes;
        return { notes: "- First round.\n- Second round." };
      },
      "resume",
      { instructions: ["b"], firstContent: "f2", approvedContent: "a2" },
    );

    expect(secondExistingNotes).toBe("- First round.");
    expect(getStyleMemory(db, "resume")?.notes).toBe("- First round.\n- Second round.");
  });

  it("propagates a runLlm rejection to the caller (the trigger site decides how to handle it)", async () => {
    const boom = new Error("provider boom");
    await expect(
      styleMemory.distill(
        db,
        async () => {
          throw boom;
        },
        "resume",
        { instructions: ["a"], firstContent: "f", approvedContent: "a" },
      ),
    ).rejects.toBe(boom);
    // Nothing was written on rejection.
    expect(getStyleMemory(db, "resume")).toBeNull();
  });
});
