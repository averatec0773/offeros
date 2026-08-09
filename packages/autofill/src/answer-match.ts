import type { AnswerEntry } from "./types";

export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A pattern hits when it appears as a whole-word phrase inside the normalized
 * question (space-padded containment — "race" never hits inside "embrace").
 *
 * Answers the USER wrote beat answers OfferOS derived, always. Length decides
 * only within a tier: a derived entry can carry a longer pattern than anything
 * a person would type, and "longest wins" alone quietly overrode the user's
 * own words with a generated blob.
 */
export function matchAnswer(questionText: string, bank: AnswerEntry[]): AnswerEntry | null {
  const q = ` ${normalizeQuestion(questionText)} `;
  let best: { entry: AnswerEntry; len: number; derived: boolean } | null = null;
  for (const entry of bank) {
    const derived = entry.derived === true;
    for (const raw of entry.questionPatterns) {
      const pattern = normalizeQuestion(raw);
      if (pattern.length === 0 || !q.includes(` ${pattern} `)) continue;
      const better =
        !best ||
        (best.derived && !derived) || // the user's own answer outranks a derived one
        (best.derived === derived && pattern.length > best.len);
      if (better) best = { entry, len: pattern.length, derived };
    }
  }
  return best?.entry ?? null;
}
