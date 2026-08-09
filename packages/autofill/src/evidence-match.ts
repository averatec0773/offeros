import { normalizeQuestion } from "./answer-match";

/**
 * Choosing which work to show, and keeping rated answers consistent.
 *
 * Both problems come straight off real engineering application forms: one asks
 * for "1-3 links to relevant work" with a description, the next asks you to
 * rate your Python proficiency and how often you used it. The first is a
 * selection problem (which projects for THIS job), the second a consistency
 * problem (the same person must not answer "High" here and "Medium" there).
 *
 * Deterministic on purpose. Nothing here needs a model: overlap between a
 * project's stack and the job's requirements is arithmetic, and the canonical
 * rating is whatever the user already committed to.
 */

export interface EvidenceItem {
  id: string;
  title: string;
  url: string;
  summary: string;
  stack: string[];
  outcome: string;
}

export interface SelfAssessmentItem {
  id: string;
  topic: string;
  level: string;
  note: string;
}

const tokens = (s: string): string[] =>
  normalizeQuestion(s)
    .split(" ")
    .filter((t) => t.length > 1);

/** Stack terms keep one-character names ("R", "C") — dropping them is what
 *  made a stack of only such names match everything. */
const stackTokens = (s: string): string[] =>
  normalizeQuestion(s)
    .split(" ")
    .filter((t) => t.length > 0);

/** How well one project answers a job, from its stack and its wording. */
export function scoreEvidence(item: EvidenceItem, jobText: string): number {
  const haystack = new Set(tokens(jobText));
  if (haystack.size === 0) return 0;
  // `[].every()` is vacuously true, and tokenizing drops one-character terms —
  // so "C++", "C#" and "R" used to normalize to nothing and therefore "match"
  // every job, padding an answer with work that has no bearing on it.
  const stackHits = item.stack.filter((s) => {
    const terms = stackTokens(s);
    return terms.length > 0 && terms.every((t) => haystack.has(t));
  }).length;
  const proseHits = tokens(`${item.title} ${item.summary}`).filter((t) => haystack.has(t)).length;
  // Stack matches are the strong signal — a shared framework says more than a
  // shared English word — so they weigh more, and prose only breaks ties.
  return stackHits * 10 + Math.min(proseHits, 10);
}

/**
 * The projects to put in front of this job, best first. `limit` reflects what
 * forms actually ask for (1-3); items that match nothing are dropped rather
 * than padding the answer with irrelevant work.
 */
export function selectEvidence(items: EvidenceItem[], jobText: string, limit = 3): EvidenceItem[] {
  return items
    .map((item) => ({ item, score: scoreEvidence(item, jobText) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => e.item);
}

/**
 * Render selected work. `multiline: false` is the default because several of
 * the questions this answers ("portfolio", "personal website", "github
 * repositories") sit on single-line inputs, which truncate at the first
 * newline — a multi-line answer would silently lose everything after the
 * first project.
 */
export function formatEvidence(items: EvidenceItem[], multiline = false): string {
  const rendered = items.map((i) => {
    const head = i.url ? `${i.title} — ${i.url}` : i.title;
    const body = [i.summary, i.outcome].filter((s) => s.trim() !== "").join(" ");
    if (!body) return head;
    return multiline ? `${head}\n${body}` : `${head}: ${body}`;
  });
  return rendered.join(multiline ? "\n\n" : " · ");
}

/**
 * The committed answer for a rated question, or null.
 *
 * Matching is topic-in-question containment on whole words: the form asks
 * "How would you rate your proficiency with Python?" and the ledger holds
 * "Python". The longest matching topic wins, so a "Python for data analysis"
 * entry beats a bare "Python" when the question is about data analysis.
 */
export function matchSelfAssessment(
  question: string,
  items: SelfAssessmentItem[],
): SelfAssessmentItem | null {
  const q = ` ${normalizeQuestion(question)} `;
  let best: { item: SelfAssessmentItem; len: number } | null = null;
  for (const item of items) {
    const topic = normalizeQuestion(item.topic);
    if (topic.length === 0 || !q.includes(` ${topic} `)) continue;
    if (!best || topic.length > best.len) best = { item, len: topic.length };
  }
  return best?.item ?? null;
}
