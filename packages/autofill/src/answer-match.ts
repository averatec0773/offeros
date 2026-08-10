import type { AnswerEntry } from "./types";

export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Function words that carry no meaning for matching a question to a stored
 * answer. Ten live fills showed why they must not be load-bearing: the bank
 * said "Are you Hispanic or Latino?" and the form said "Are you
 * Hispanic/Latino?" — after normalization the only difference was the word
 * "or", and the whole-phrase match failed on it, leaving an EEO question the
 * user HAD answered sitting unfilled on two real applications.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "or",
  "and",
  "of",
  "in",
  "on",
  "to",
  "for",
  "with",
  "do",
  "does",
  "did",
  "are",
  "is",
  "was",
  "be",
  "you",
  "your",
  "yourself",
  "have",
  "has",
  "please",
  "any",
  "at",
  "as",
  "by",
]);

/** The words in a pattern that actually identify the question. */
function contentTokens(pattern: string): string[] {
  return pattern.split(" ").filter((t) => t !== "" && !STOPWORDS.has(t));
}

/**
 * A pattern hits when it appears as a whole-word phrase inside the normalized
 * question (space-padded containment — "race" never hits inside "embrace"),
 * or — one rung below — when every one of its CONTENT words appears as a
 * whole word in the question. The token rung is what survives rewording
 * ("Hispanic or Latino" vs "Hispanic/Latino"); the phrase rung stays above it
 * so exact wording still wins when both hit.
 *
 * Answers the USER wrote beat answers OfferOS derived, always — across both
 * rungs: a user answer that only token-matches still outranks a derived
 * answer with an exact phrase, because the wrong tier here means a generated
 * blob quietly overriding the user's own words. Length decides only within a
 * tier and rung.
 */
export function matchAnswer(questionText: string, bank: AnswerEntry[]): AnswerEntry | null {
  const q = ` ${normalizeQuestion(questionText)} `;
  let best: { entry: AnswerEntry; len: number; derived: boolean; phrase: boolean } | null = null;
  for (const entry of bank) {
    const derived = entry.derived === true;
    for (const raw of entry.questionPatterns) {
      const pattern = normalizeQuestion(raw);
      if (pattern.length === 0) continue;

      let phrase = false;
      if (q.includes(` ${pattern} `)) {
        phrase = true;
      } else {
        const tokens = contentTokens(pattern);
        // A pattern that is ALL stopwords identifies nothing; and the token
        // rung still requires every content word whole (space-padded), so
        // "race" cannot hit inside "embrace" here either.
        if (tokens.length === 0 || !tokens.every((t) => q.includes(` ${t} `))) continue;
      }

      const better =
        !best ||
        (best.derived && !derived) || // the user's own answer outranks a derived one
        (best.derived === derived &&
          ((phrase && !best.phrase) || // exact wording outranks a token match
            (phrase === best.phrase && pattern.length > best.len)));
      if (better) best = { entry, len: pattern.length, derived, phrase };
    }
  }
  return best?.entry ?? null;
}
