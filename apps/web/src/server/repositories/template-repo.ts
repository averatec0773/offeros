import { eq } from "drizzle-orm";
import { templateSchema, type Template } from "@offeros/core";
import type { Db } from "../db/client";
import { templates } from "../db/schema";

export function listTemplates(db: Db): Template[] {
  return db
    .select()
    .from(templates)
    .all()
    .map((row) => templateSchema.parse(row.doc));
}

export function getTemplate(db: Db, id: string): Template | null {
  const row = db.select().from(templates).where(eq(templates.id, id)).get();
  return row ? templateSchema.parse(row.doc) : null;
}

/** First template with the given name, or null. Used for re-import stability. */
export function findTemplateByName(db: Db, name: string): Template | null {
  return listTemplates(db).find((t) => t.name === name) ?? null;
}

/** The default template for `kind`, or null when none is marked default. */
export function getDefaultTemplate(db: Db, kind: string): Template | null {
  return listTemplates(db).find((t) => t.kind === kind && t.isDefault) ?? null;
}

export function upsertTemplate(db: Db, doc: Template): Template {
  const parsed = templateSchema.parse(doc);
  db.insert(templates)
    .values({ id: parsed.id, doc: parsed, updatedAt: parsed.updatedAt })
    .onConflictDoUpdate({
      target: templates.id,
      set: { doc: parsed, updatedAt: parsed.updatedAt },
    })
    .run();
  return parsed;
}

export function deleteTemplateRow(db: Db, id: string): boolean {
  const existing = db.select().from(templates).where(eq(templates.id, id)).get();
  if (!existing) return false;
  db.delete(templates).where(eq(templates.id, id)).run();
  return true;
}

/** Clears `isDefault` on every template of `kind` except `exceptId`, enforcing
 *  the single-default-per-kind invariant. */
export function clearDefaultForKind(db: Db, kind: string, exceptId?: string): void {
  const now = Date.now();
  for (const t of listTemplates(db)) {
    if (t.kind !== kind || t.id === exceptId || !t.isDefault) continue;
    const doc = { ...t, isDefault: false, updatedAt: now };
    db.update(templates).set({ doc, updatedAt: now }).where(eq(templates.id, t.id)).run();
  }
}
