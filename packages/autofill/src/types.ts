// Local, self-contained types for @offeros/autofill. This package must not
// depend on the extension's src/lib/types.ts — AnswerEntry here mirrors that
// shape structurally, so extension callers passing their own AnswerEntry[]
// still typecheck.

export type AnswerType = "enum" | "text" | "number" | "boolean";
export type AnswerCategory = "eeo" | "screening" | "custom";

export interface AnswerEntry {
  id: string;
  questionPatterns: string[]; // non-empty; normalized keyword phrases
  answer: string;
  type: AnswerType;
  category: AnswerCategory;
  /** True for entries OfferOS derived for this job rather than answers the
   *  user wrote. Matching prefers the user's own words regardless of which
   *  pattern happens to be longer. */
  derived?: boolean;
}

// Minimal input contract for buildFillPlan — exactly the fields `personalValue`
// and buildFillPlan read off a profile. Mirrors the extension's Profile shape
// structurally, so extension callers pass their own Profile unchanged.
export interface FillPersonalInfo {
  name: string;
  email: string;
  phone: string;
  address: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  /** Most recent work experience, for "current company / job title" fields. */
  recentCompany?: string;
  recentTitle?: string;
  /** Highest degree earned (e.g. "Masters") — answers education-level choice groups. */
  highestDegree?: string;
  links: { linkedin?: string; github?: string; portfolio?: string };
}

/**
 * One schooling entry, as a repeated row needs it.
 *
 * Structurally mirrors `@offeros/core`'s Education so the server can pass its
 * own records straight through, and this package stays free of that dependency.
 */
export interface FillEducation {
  school: string;
  degree: string;
  field: string;
  start: string;
  end: string;
}

/** One job, as a repeated row needs it — bullets included. */
export interface FillExperience {
  company: string;
  title: string;
  start: string;
  end: string;
  /** The applicant's own description of the work, as they wrote it. */
  bullets: string[];
}

export interface FillProfile {
  personal: FillPersonalInfo;
  skills: string[];
  answerBank: AnswerEntry[];
  /**
   * The histories, as lists rather than as a single flattened "most recent".
   *
   * `personal.recentCompany` and `recentTitle` answer the ordinary "current
   * employer" field and are unchanged. These exist for the other shape: a form
   * with three education rows and three experience rows, where every row used
   * to receive entry zero — so an applicant's three jobs all came out as the
   * same company.
   */
  education: FillEducation[];
  experience: FillExperience[];
}
