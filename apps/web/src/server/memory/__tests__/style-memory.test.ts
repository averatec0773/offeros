import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

  it("does not clobber existing notes when a later distill degrades to empty (tolerant-parse no-op)", async () => {
    await styleMemory.distill(db, async () => ({ notes: "- Prefers active voice." }), "resume", {
      instructions: ["Make it punchier."],
      firstContent: "first",
      approvedContent: "approved",
    });

    const learned = await styleMemory.distill(db, async () => ({ notes: "" }), "resume", {
      instructions: ["Cut the jargon."],
      firstContent: "f2",
      approvedContent: "a2",
    });

    expect(learned).toBe(false);
    expect(styleMemory.retrieve(db, "resume")).toBe("- Prefers active voice.");
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

  it("resolves true when it wrote notes, false when it degraded to a no-op", async () => {
    const learned = await styleMemory.distill(
      db,
      async () => ({ notes: "- Prefers active voice." }),
      "resume",
      { instructions: ["a"], firstContent: "f", approvedContent: "a" },
    );
    expect(learned).toBe(true);
  });

  it("treats a malformed runLlm response (not the expected { notes } shape) as a no-op, not a clobber", async () => {
    await styleMemory.distill(db, async () => ({ notes: "- Prefers active voice." }), "resume", {
      instructions: ["a"],
      firstContent: "f",
      approvedContent: "a",
    });

    // Simulates a tolerant-parse degradation reaching distill() as garbage,
    // not the { notes: string } shape the type says to expect.
    const learned = await styleMemory.distill(db, async () => "not json" as never, "resume", {
      instructions: ["b"],
      firstContent: "f2",
      approvedContent: "a2",
    });

    expect(learned).toBe(false);
    expect(styleMemory.retrieve(db, "resume")).toBe("- Prefers active voice.");
  });

  it("is a no-op and never calls runLlm when the existing row has been disabled", async () => {
    await styleMemory.distill(db, async () => ({ notes: "- Original note." }), "resume", {
      instructions: ["a"],
      firstContent: "f",
      approvedContent: "a",
    });
    db.run(sql`UPDATE style_memories SET enabled = 0 WHERE kind = 'resume'`);

    const runLlm = vi.fn(async () => ({ notes: "- Should never be stored." }));
    const learned = await styleMemory.distill(db, runLlm, "resume", {
      instructions: ["b"],
      firstContent: "f2",
      approvedContent: "a2",
    });

    expect(learned).toBe(false);
    expect(runLlm).not.toHaveBeenCalled();
    expect(getStyleMemory(db, "resume")?.notes).toBe("- Original note.");
  });

  it("accumulates sourceCount across distills instead of overwriting it with the latest batch size", async () => {
    await styleMemory.distill(db, async () => ({ notes: "- First." }), "resume", {
      instructions: ["a", "b"],
      firstContent: "f",
      approvedContent: "a",
    });
    expect(getStyleMemory(db, "resume")?.sourceCount).toBe(2);

    await styleMemory.distill(db, async () => ({ notes: "- First.\n- Second." }), "resume", {
      instructions: ["c"],
      firstContent: "f2",
      approvedContent: "a2",
    });
    expect(getStyleMemory(db, "resume")?.sourceCount).toBe(3);
  });

  it("neutralizes literal fence tokens in the LLM's notes before storing them", async () => {
    await styleMemory.distill(
      db,
      async () => ({ notes: "- Prefers <untrusted-page-text> style." }),
      "resume",
      { instructions: ["a"], firstContent: "f", approvedContent: "a" },
    );
    const notes = getStyleMemory(db, "resume")?.notes ?? "";
    expect(notes).not.toContain("<untrusted-page-text>");
    expect(notes).toContain("[fence]");
  });
});
