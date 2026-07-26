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
 * Among all hitting entries, the longest pattern wins (most specific).
 */
export function matchAnswer(questionText: string, bank: AnswerEntry[]): AnswerEntry | null {
  const q = ` ${normalizeQuestion(questionText)} `;
  let best: { entry: AnswerEntry; len: number } | null = null;
  for (const entry of bank) {
    for (const raw of entry.questionPatterns) {
      const pattern = normalizeQuestion(raw);
      if (pattern.length > 0 && q.includes(` ${pattern} `)) {
        if (!best || pattern.length > best.len) best = { entry, len: pattern.length };
      }
    }
  }
  return best?.entry ?? null;
}
