import { normalizeQuestion } from "@offeros/autofill";
import type { AnswerEntry } from "@offeros/core";
import type { Db } from "../db/client";
import { createAnswer, deleteAnswer, listAnswers, updateAnswer } from "../repositories/answer-repo";
import { appendEvent } from "../repositories/application-event-repo";

/**
 * Writing to the answer bank, with the two properties the storage layer alone
 * cannot give it: one entry per question, and a record that the change happened.
 *
 * Both come from the same incident. The Equal Employment section and the
 * Answers list are two front-ends onto this one bank; the user, seeing the same
 * questions in both, deleted them from the list as duplicates and wiped the
 * only copy. Nothing anywhere recorded that a deletion had occurred, so the
 * next application simply had no answer for work authorization and there was
 * nothing to look at afterwards to find out why.
 */

/**
 * The audit trail's owner.
 *
 * Answer-bank changes belong to no single application, and the event table's
 * `application_id` is a plain column rather than a foreign key, so a scope name
 * sits there instead of an id. `listEvents` filters by exact id, so these rows
 * can never surface inside a real application's timeline.
 */
export const ANSWER_BANK_SCOPE = "answer-bank";

/** What an audit row says. Deliberately not the answer itself. */
function audit(db: Db, kind: string, entry: AnswerEntry): void {
  appendEvent(db, {
    applicationId: ANSWER_BANK_SCOPE,
    kind,
    payload: {
      answerId: entry.id,
      // The question, not the answer: this is a record that something changed,
      // not a second copy of what someone said about their disability status.
      question: (entry.questionPatterns[0] ?? "").slice(0, 120),
      category: entry.category,
    },
  });
}

/**
 * An existing entry for the same question, if the bank already holds one.
 *
 * Same category and a shared pattern. Category keeps a screening "Work
 * authorization" apart from the EEO question that happens to use similar
 * words; the shared pattern is the actual test, because a pattern IS the key
 * the fill engine matches on — two entries carrying the same one are already
 * ambiguous, and whichever the matcher reached first would win.
 */
function existingFor(db: Db, input: Omit<AnswerEntry, "id">): AnswerEntry | null {
  const wanted = new Set(input.questionPatterns.map(normalizeQuestion).filter((p) => p !== ""));
  if (wanted.size === 0) return null;
  return (
    listAnswers(db).find(
      (entry) =>
        entry.category === input.category &&
        entry.questionPatterns.some((p) => wanted.has(normalizeQuestion(p))),
    ) ?? null
  );
}

/**
 * Save an answer: update the entry for this question, or create the first one.
 *
 * Every surface that adds to the bank comes through here — the profile page,
 * the Equal Employment section, the panel accepting an answer during a fill —
 * so none of them can produce a second entry for a question that already has
 * one. Patterns are unioned rather than replaced: an entry that has picked up
 * a real form's wording keeps it.
 */
export function saveAnswer(db: Db, input: Omit<AnswerEntry, "id">): AnswerEntry {
  const existing = existingFor(db, input);
  if (!existing) {
    const created = createAnswer(db, input);
    audit(db, "answer.created", created);
    return created;
  }
  const merged = updateAnswer(db, existing.id, {
    ...input,
    questionPatterns: [...new Set([...existing.questionPatterns, ...input.questionPatterns])],
  });
  // Only null if the row vanished between the read and the write.
  if (!merged) return createAnswer(db, input);
  audit(db, "answer.updated", merged);
  return merged;
}

/** Edit one entry by id. */
export function editAnswer(
  db: Db,
  id: string,
  patch: Partial<Omit<AnswerEntry, "id">>,
): AnswerEntry | null {
  const updated = updateAnswer(db, id, patch);
  if (updated) audit(db, "answer.updated", updated);
  return updated;
}

/** Delete one entry by id, recording what was deleted before it goes. */
export function removeAnswer(db: Db, id: string): boolean {
  const doomed = listAnswers(db).find((entry) => entry.id === id);
  const removed = deleteAnswer(db, id);
  if (removed && doomed) audit(db, "answer.deleted", doomed);
  return removed;
}
