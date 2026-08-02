import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { styleMemories } from "../db/schema";

export type StyleMemoryKind = "resume" | "cover-letter";

export interface StyleMemoryRow {
  kind: StyleMemoryKind;
  notes: string;
  enabled: boolean;
  sourceCount: number;
  updatedAt: number;
}

/** The `/settings/style` GET/PUT response shape: a `StyleMemoryRow`, except
 *  `updatedAt` is `null` for a kind with no stored row yet, instead of a
 *  fabricated timestamp — callers use `null` to skip an "updated <date>"
 *  caption entirely. */
export type StyleMemorySetting = Omit<StyleMemoryRow, "updatedAt"> & { updatedAt: number | null };

/** Hard cap on stored notes — the distill task is told this number too (see
 *  `server/memory/style-memory.ts`), but the repo truncates defensively in
 *  case the LLM ignores the instruction. */
export const STYLE_MEMORY_MAX_CHARS = 2000;

export function getStyleMemory(db: Db, kind: StyleMemoryKind): StyleMemoryRow | null {
  const row = db.select().from(styleMemories).where(eq(styleMemories.kind, kind)).get();
  if (!row) return null;
  return {
    kind: row.kind as StyleMemoryKind,
    notes: row.notes,
    enabled: row.enabled,
    sourceCount: row.sourceCount,
    updatedAt: row.updatedAt,
  };
}

/** Upserts keyed by `kind`. Truncates `notes` to `STYLE_MEMORY_MAX_CHARS`
 *  defensively. `enabled` is only set (to `true`) on first insert — an
 *  existing row's enabled flag is never touched by a distill write, so a
 *  user who disabled style memory doesn't get silently re-enabled by the
 *  next approval. */
export function upsertStyleMemory(
  db: Db,
  kind: StyleMemoryKind,
  patch: { notes: string; sourceCount: number },
): StyleMemoryRow {
  const notes =
    patch.notes.length > STYLE_MEMORY_MAX_CHARS
      ? patch.notes.slice(0, STYLE_MEMORY_MAX_CHARS)
      : patch.notes;
  const now = Date.now();
  db.insert(styleMemories)
    .values({ kind, notes, enabled: true, sourceCount: patch.sourceCount, updatedAt: now })
    .onConflictDoUpdate({
      target: styleMemories.kind,
      set: { notes, sourceCount: patch.sourceCount, updatedAt: now },
    })
    .run();
  return getStyleMemory(db, kind)!;
}

/** Direct user-driven write from the Style settings page: updates `notes`
 *  and/or `enabled` for `kind`, leaving `sourceCount` untouched (a manual
 *  edit isn't a new distilled approval). Truncates `notes` to
 *  `STYLE_MEMORY_MAX_CHARS` defensively, same as `upsertStyleMemory`. Missing
 *  fields keep their existing (or default) value — a row with no prior
 *  approvals is created on first write with `notes: ""`, `enabled: true`. */
export function setStyleMemory(
  db: Db,
  kind: StyleMemoryKind,
  patch: { notes?: string; enabled?: boolean },
): StyleMemoryRow {
  const existing = getStyleMemory(db, kind);
  const rawNotes = patch.notes ?? existing?.notes ?? "";
  const notes =
    rawNotes.length > STYLE_MEMORY_MAX_CHARS ? rawNotes.slice(0, STYLE_MEMORY_MAX_CHARS) : rawNotes;
  const enabled = patch.enabled ?? existing?.enabled ?? true;
  const sourceCount = existing?.sourceCount ?? 0;
  const now = Date.now();
  db.insert(styleMemories)
    .values({ kind, notes, enabled, sourceCount, updatedAt: now })
    .onConflictDoUpdate({
      target: styleMemories.kind,
      set: { notes, enabled, updatedAt: now },
    })
    .run();
  return getStyleMemory(db, kind)!;
}
