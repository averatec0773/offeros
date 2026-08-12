import type { JobIdentity } from "../job-url";
import type { ReconQuestion } from "../services/recon/types";

/**
 * Getting a job posting's details, as a ladder of evidence rather than a
 * lookup table of domains.
 *
 * The old shape asked one question — "does this URL's hostname belong to a
 * platform I know?" — and gave up if the answer was no. That turned out to be
 * unfixable rather than incomplete: employers embed a board's job into their
 * own careers page, so the posting lives at `company.com/careers/...` with the
 * board's id in the query string. Worse, a board's OWN link 301s to the
 * employer's domain. A hostname is not an identity.
 *
 * So platforms are recognised by EVIDENCE, from whichever source has it:
 *
 *   1. the URL          — free, no request
 *   2. the page's HTML  — one request; mostly for the fingerprint that says
 *                         which board is behind this page, and for whatever
 *                         structured data the page happens to carry
 *   3. the vendor's API — one request; the real content, and on some platforms
 *                         the application's questions too
 *   4. the browser      — the extension, which can see a page JavaScript built.
 *                         Not implemented here; the seam is reserved so it can
 *                         arrive without reshaping anything
 *   5. paste            — the user, always available, always allowed to win
 *   6. a model          — only ever to TIDY text already obtained, never to
 *                         obtain it
 *
 * Adding a platform must mean adding an adapter and registering it. If it ever
 * means editing the ladder, the merge, or a caller, the seam is wrong and the
 * seam is what should change.
 */

/** Where a piece of information came from. Ordered: later beats earlier. */
export const EVIDENCE_SOURCES = [
  "url",
  "page-summary",
  "page",
  "vendor-api",
  "browser",
  "manual",
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/** How much a source is trusted when two of them disagree. */
export const SOURCE_RANK: Record<EvidenceSource, number> = {
  url: 1,
  /**
   * A page's own one-paragraph blurb — `og:description` and friends.
   *
   * Ranked below the rendered body on purpose. It used to share the page rank,
   * and since equal ranks keep whichever arrived first and the meta collector
   * runs before the body collector, a 150-character summary beat a complete
   * description every time. That is how a job description became a sentence.
   */
  "page-summary": 2,
  page: 3,
  "vendor-api": 4,
  // The rendered DOM beats a server-side guess: it is what the applicant sees.
  browser: 5,
  // Nothing outranks a person telling us directly.
  manual: 6,
};

/** True when a description came from a blurb rather than the posting itself. */
export function isSummarySource(source: string | undefined): boolean {
  return source === "page-summary";
}

/** What we try to learn about a posting. Every field optional, always: a field
 *  we did not find is absent, never an empty string pretending to be a value. */
export interface JobFields {
  title?: string;
  company?: string;
  location?: string;
  jdText?: string;
  salary?: string;
  deadline?: string;
  postedAt?: string;
}

export type JobFieldName = keyof JobFields;

/** One collector's yield. Partial by nature — a fingerprint alone is a useful
 *  result even with no fields at all. */
export interface Evidence {
  source: EvidenceSource;
  vendor?: string;
  identity?: JobIdentity;
  fields: JobFields;
  questions?: ReconQuestion[];
  /** Set when this evidence came from a page that redirected. */
  finalUrl?: string;
}

/** What one rung of the ladder did, for honest reporting when little worked. */
export interface LadderAttempt {
  layer: EvidenceSource;
  detail: string;
  ok: boolean;
}

export interface ExtractedJob {
  fields: JobFields;
  /** What the page fetch did, so a caller wanting a verdict (is this posting
   *  still up?) can have one without fetching the page a second time. */
  page?: { ok: boolean; status?: number; reason?: string; redirected?: boolean };
  /** The fetched markup, kept so a caller can read a platform's closed-page
   *  wording out of it without fetching the page again. */
  pageText?: string;
  /** True when the platform itself answered with the posting — the strongest
   *  evidence there is that a job is still live. */
  vendorAnswered?: boolean;
  /** Which source each field came from — the seam for a future field-by-field
   *  merge, and what lets the UI say where a description came from. */
  sources: Partial<Record<JobFieldName, EvidenceSource>>;
  identity?: JobIdentity;
  vendor?: string;
  questions: ReconQuestion[];
  attempts: LadderAttempt[];
  finalUrl?: string;
}

export interface VendorDeps {
  fetchImpl?: typeof fetch;
  resolve?: (hostname: string) => Promise<string[]>;
  signal?: AbortSignal;
}

/**
 * One platform's knowledge, and the whole of what a new platform must provide.
 *
 * Two ways to be recognised, because one is not enough: `fromUrl` catches a
 * link that carries its own identity anywhere on the web, and `fromHtml`
 * catches the case that broke the old design — a page on a company's own
 * domain whose markup names the board behind it.
 */
export interface VendorAdapter {
  vendor: string;
  /** Identity from the link alone. Free, no request. */
  fromUrl(url: string): JobIdentity | null;
  /** Identity from a fetched page's markup — the embed script, a data
   *  attribute, an API host it talks to. */
  fromHtml(html: string, pageUrl: string): JobIdentity | null;
  /** Ask the platform directly. Null when it cannot answer for this identity. */
  fetchJob(identity: JobIdentity, deps: VendorDeps): Promise<Evidence | null>;
  /** The platform's own "this job is closed" wording, when we know it. */
  closedMarker?(html: string): boolean;
}
