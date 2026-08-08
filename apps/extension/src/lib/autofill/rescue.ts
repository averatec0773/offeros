/**
 * Directory rescue: deterministic matching of a held job's title against the
 * posting links found on a board page. Pure and threshold-gated — the panel
 * auto-jumps only on a confident match; anything weaker becomes a human
 * candidate list, never a guess.
 */

export interface PostingLink {
  href: string;
  text: string;
}

/** Same page ignoring the hash and a trailing slash. A form page's own
 *  "Application" link points at itself — jumping there would reload forever. */
export function isSameTarget(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const url = new URL(u);
      return `${url.origin}${url.pathname.replace(/\/+$/, "")}${url.search}`.toLowerCase();
    } catch {
      return u.trim().toLowerCase();
    }
  };
  return norm(a) === norm(b);
}

/**
 * Rescue jumps are budgeted per TAB and remembered across navigations —
 * every jump destroys and remounts the panel, so an in-memory guard alone
 * would let a page that keeps reading as form-less loop forever (observed
 * live: 48 jumps in one run before this existed). sessionStorage is scoped to
 * the tab, which is exactly the lifetime a rescue budget should have.
 */
const RESCUE_LOG_KEY = "offeros-rescue-jumps";
const RESCUE_BUDGET = 3;

function readRescueLog(store: Storage | undefined): string[] {
  try {
    const raw = store?.getItem(RESCUE_LOG_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** True when a jump to `target` is still allowed for this tab. */
export function mayAttemptRescue(store: Storage | undefined, target: string): boolean {
  const log = readRescueLog(store);
  if (log.length >= RESCUE_BUDGET) return false;
  return !log.some((t) => isSameTarget(t, target));
}

export function noteRescueAttempt(store: Storage | undefined, target: string): void {
  try {
    const log = readRescueLog(store);
    log.push(target);
    store?.setItem(RESCUE_LOG_KEY, JSON.stringify(log.slice(-RESCUE_BUDGET)));
  } catch {
    // Storage unavailable (sandboxed frame) — the in-memory guard still applies.
  }
}

/** Landing on a real form ends the episode: the next job starts with a full budget. */
export function clearRescueLog(store: Storage | undefined): void {
  try {
    store?.removeItem(RESCUE_LOG_KEY);
  } catch {
    // see above
  }
}

export interface RankedPostingLink extends PostingLink {
  score: number;
}

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

/** Share of the job title's tokens present in the link text (0..1). */
export function scoreTitleMatch(jobTitle: string, linkText: string): number {
  const title = tokenize(jobTitle);
  if (title.length === 0) return 0;
  const link = new Set(tokenize(linkText));
  const hits = title.filter((t) => link.has(t)).length;
  return hits / title.length;
}

/** All links ranked by title-match score, best first (stable for ties). */
export function rankPostingLinks(links: PostingLink[], jobTitle: string): RankedPostingLink[] {
  return links
    .map((l) => ({ ...l, score: scoreTitleMatch(jobTitle, l.text) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * The auto-jump pick: the best link, but only when it's a CONFIDENT match —
 * at least 60% of the title's tokens and at least two of them (a single
 * shared word like "Engineer" must never auto-navigate).
 */
export function pickPostingLink(
  links: PostingLink[],
  jobTitle: string,
): RankedPostingLink | null {
  const ranked = rankPostingLinks(links, jobTitle);
  const best = ranked[0];
  if (!best || best.score < 0.6) return null;
  const titleTokens = tokenize(jobTitle).length;
  if (Math.round(best.score * titleTokens) < 2) return null;
  return best;
}
