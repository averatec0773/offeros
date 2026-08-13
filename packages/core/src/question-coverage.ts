/**
 * The vocabulary for "what do application forms ask me, and can I answer it".
 *
 * One set of types, defined here because `packages/core` is the layer with no
 * IO and therefore the only place all the others can agree on. Nothing below
 * may define its own version of these — a second `CoverageState` somewhere in
 * the server or a shape the UI invents for itself is how two answers to the
 * same question start disagreeing.
 *
 * The layering these types hold together:
 *
 *   sources  →  read model  →  consumers
 *
 *   - a SOURCE knows one way we came to hear about a question (a real fill we
 *     performed, a platform's public description of its own form, whatever
 *     comes next). It produces `ObservedQuestion` and knows nothing about
 *     answers, profiles or guards.
 *   - the READ MODEL merges every source, reconciles the result against what
 *     the user can actually answer, and produces `CoveredQuestion`. It is the
 *     single place that decides coverage.
 *   - a CONSUMER — a card, a page, an agent tool — reads `CoveredQuestion` and
 *     nothing else. No consumer queries the database directly, so a change in
 *     how questions are stored cannot reach them.
 */

/** How we came to know a form asks this. */
export type QuestionOrigin =
  /** We filled the form and the engine reported the field. Nothing beats
   *  having been there: this is the form as it actually is. */
  | "fill"
  /** The platform's own public description of the form, read before applying.
   *  Earlier and cheaper, but it is the form as advertised. */
  | "prescan";

/** One sighting of one question, from one source. */
export interface ObservedQuestion {
  /** Stable identity of the question itself, across postings and platforms. */
  questionKey: string;
  /** The question as it was asked, for a human to read. */
  question: string;
  /** The kind of control it was asked with, in the fill engine's vocabulary. */
  control: string;
  required: boolean;
  origin: QuestionOrigin;
  /** The platform, when the source knows it. */
  vendor?: string;
  /**
   * The application this sighting belongs to, when the source can attribute it.
   *
   * Optional on purpose. A source that counts sightings globally (the shape
   * table does) cannot say which applications they came from, and inventing an
   * attribution to satisfy the type would put a number in front of the user
   * that nothing backs.
   */
  applicationId?: string;
  at?: number;
}

/** Whether the user can answer a question, and if not, why not. */
export type CoverageState =
  /** A saved answer or a profile field covers it. */
  | "answered"
  /** Nothing covers it. This is the gap worth showing. */
  | "unanswered"
  /**
   * Not ours to answer. Identity and self-identification questions, and legal
   * assertions about the applicant's own status — OfferOS refuses these by
   * design rather than by omission, so they are never counted as a gap the
   * user has failed to close.
   */
  | "not-ours";

/** One question, everything known about it, ready for a consumer to render. */
export interface CoveredQuestion {
  questionKey: string;
  question: string;
  control: string;
  /** True when ANY sighting had it required. A question that is optional on one
   *  form and required on another is a question worth answering. */
  required: boolean;
  state: CoverageState;
  /** Why it is not ours to answer. Present only for `not-ours`. */
  guard?: "sensitive" | "truth" | "policy";
  /** Distinct applications this question was seen on, where sightings could be
   *  attributed. Zero when every sighting came from an unattributed source. */
  seenOnApplications: number;
  /** Total sightings, attributed or not. Always at least 1. */
  timesSeen: number;
  /** The platforms it was seen on, deduplicated. */
  vendors: string[];
  /** Which kinds of source have seen it. */
  origins: QuestionOrigin[];
}

/** What a consumer asks the read model for. */
export interface CoverageScope {
  /** Restrict to one application's own form. Omitted = everything we know. */
  applicationId?: string;
}

/** A question the user has not answered, as the gaps list shows it. */
export interface AnswerGap extends CoveredQuestion {
  state: "unanswered" | "not-ours";
}

/** The gaps list: what to answer next, and how much was left out. */
export interface AnswerGaps {
  /** Unanswered questions, most-seen first. */
  gaps: AnswerGap[];
  /** Questions OfferOS will not answer for you, kept apart from the to-do. */
  notOurs: AnswerGap[];
  /** How many unanswered questions exist in total, before any cap. */
  total: number;
  /**
   * True when at least one sighting could not be attributed to an application,
   * so `seenOnApplications` understates reality and the UI has to say so.
   */
  hasUnattributedSightings: boolean;
}
