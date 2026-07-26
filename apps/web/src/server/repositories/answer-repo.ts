import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { answerSchema, type AnswerEntry } from "@offeros/core";
import type { Db } from "../db/client";
import { answers } from "../db/schema";

export function listAnswers(db: Db): AnswerEntry[] {
  return db
    .select()
    .from(answers)
    .all()
    .map((row) => answerSchema.parse(row.doc));
}

export function createAnswer(db: Db, input: Omit<AnswerEntry, "id">): AnswerEntry {
  const doc = answerSchema.parse({ ...input, id: randomUUID() });
  db.insert(answers).values({ id: doc.id, doc, updatedAt: Date.now() }).run();
  return doc;
}

export function updateAnswer(
  db: Db,
  id: string,
  patch: Partial<Omit<AnswerEntry, "id">>,
): AnswerEntry | null {
  const existing = db.select().from(answers).where(eq(answers.id, id)).get();
  if (!existing) return null;
  const doc = answerSchema.parse({ ...existing.doc, ...patch, id });
  db.update(answers).set({ doc, updatedAt: Date.now() }).where(eq(answers.id, id)).run();
  return doc;
}

export function deleteAnswer(db: Db, id: string): boolean {
  const existing = db.select().from(answers).where(eq(answers.id, id)).get();
  if (!existing) return false;
  db.delete(answers).where(eq(answers.id, id)).run();
  return true;
}
