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
  links: { linkedin?: string; github?: string; portfolio?: string };
}

export interface FillProfile {
  personal: FillPersonalInfo;
  skills: string[];
  answerBank: AnswerEntry[];
}
