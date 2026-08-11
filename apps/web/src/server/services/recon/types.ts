import type { MetaControl } from "@offeros/autofill";

/**
 * What one reconnaissance run can conclude about a posting.
 *
 * Four values, and the fourth is the important one. A checker that only ever
 * says open/closed will say "closed" about a site that wanted a login, and a
 * wrong "closed" costs the user a job they could still have applied to.
 * `unknown` is what we say when we genuinely could not tell, and it is not a
 * failure state to be hidden — it is the honest answer.
 */
export type ReconVerdict =
  /** The posting answered and still looks live. */
  | "open"
  /** The platform says so: gone from its API, or its own closed-page copy. */
  | "closed"
  /** Bounced to a board index or a generic careers page — the usual shape of a
   *  removed posting, but inferred rather than stated. */
  | "suspected-closed"
  /** Could not reach it, or it is somewhere we cannot read. Not a guess. */
  | "unknown";

/** One question a form will ask, as the platform describes it. */
export interface ReconQuestion {
  /** Computed with `@offeros/autofill`'s `questionKey`, so a question learned
   *  here is the same row as the same question met during a real fill. */
  questionKey: string;
  question: string;
  control: MetaControl;
  required: boolean;
}

/** What a probe found out, before the service decides what to store. */
export interface ProbeResult {
  verdict: ReconVerdict;
  /** Present when the platform handed back the posting itself. */
  job?: {
    title: string;
    company: string;
    location: string;
    /** Untrusted: markup from a third party. Only ever stored as jdText, whose
     *  consumers already fence it before it reaches a model. */
    descriptionHtml: string;
  };
  questions?: ReconQuestion[];
}

/**
 * One ATS's reconnaissance. Registered per platform so adding Lever or Ashby
 * is a new module and one array entry, not a branch in the service.
 */
export interface AtsRecon {
  vendor: string;
  matches: (url: string) => boolean;
  /** Does this page text carry the platform's own "closed" wording? */
  closedMarker: (html: string) => boolean;
  /** Ask the platform directly, where it has an API worth asking. Null when
   *  this URL is not one this module can address. */
  probe?: (
    url: string,
    fetchImpl: typeof fetch,
    signal?: AbortSignal,
  ) => Promise<ProbeResult | null>;
}
