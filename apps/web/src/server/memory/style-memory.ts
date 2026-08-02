import type { Db } from "../db/client";
import {
  getStyleMemory,
  upsertStyleMemory,
  STYLE_MEMORY_MAX_CHARS,
  type StyleMemoryKind,
} from "../repositories/style-memory-repo";

export type { StyleMemoryKind };

/** The signals an approval hands to `distill`: the applicant's own tweak
 *  instructions (in order), the first AI-generated draft, and the version
 *  they ultimately approved. */
export interface DistillSignals {
  instructions: string[];
  firstContent: string;
  approvedContent: string;
}

/** Matches `PipelineContext.runLlm` — kept local so this module doesn't
 *  depend on the pipeline layer (only the other way around). */
export type RunLlm = (taskId: string, input: unknown) => Promise<unknown>;

/**
 * Pluggable style-memory contract. `distilled-notes` (below) is the only
 * implementation today; a future few-shot or embedding store would implement
 * the same contract and register alongside it — callers never import an
 * implementation directly, only `styleMemory` (or the registry) from this
 * module.
 */
export interface StyleMemoryStore {
  /** The grounding block for `kind`, or `null` when disabled or empty. */
  retrieve(db: Db, kind: StyleMemoryKind): string | null;
  /** Update the stored memory for `kind` from an approval's signals. */
  distill(db: Db, runLlm: RunLlm, kind: StyleMemoryKind, signals: DistillSignals): Promise<void>;
}

const distilledNotesStore: StyleMemoryStore = {
  retrieve(db, kind) {
    const row = getStyleMemory(db, kind);
    if (!row || !row.enabled) return null;
    return row.notes.trim() === "" ? null : row.notes;
  },
  async distill(db, runLlm, kind, signals) {
    const existing = getStyleMemory(db, kind);
    const input = {
      existingNotes: existing?.notes ?? "",
      instructions: signals.instructions,
      firstContent: signals.firstContent,
      approvedContent: signals.approvedContent,
      maxChars: STYLE_MEMORY_MAX_CHARS,
    };
    const output = (await runLlm("style-distill", input)) as { notes: string };
    upsertStyleMemory(db, kind, { notes: output.notes, sourceCount: signals.instructions.length });
  },
};

/** Registered style-memory implementations, keyed by name — the migration
 *  seam. `distilled-notes` is the only one registered today. */
export const styleMemoryRegistry: Record<"distilled-notes", StyleMemoryStore> = {
  "distilled-notes": distilledNotesStore,
};

/** The active implementation. Swapping implementations touches only this line. */
export const styleMemory: StyleMemoryStore = styleMemoryRegistry["distilled-notes"];
