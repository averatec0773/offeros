// A diverse, ground-truth resume corpus for measuring autofill adaptation.
//
// The data lives in resume-corpus.json (single source of truth, shared with the
// real-PDF extraction script apps/extension/scripts/resume-adaptation.mjs).
// Each entry captures
// the personal facts a real resume carries, plus the reasonable first/last split
// an ATS with separate name fields expects. The archetypes deliberately span the
// shapes that break naive autofill: middle names, "Last, First" ordering,
// particle surnames, hyphenation, suffixes, international phones, and links
// written without a scheme.
//
// `fullName` is the name exactly as it would land in the profile after parse.
// `expectedFirst` / `expectedLast` are what a first/last-name form should
// receive. `expectedLinks` are the values a URL field should receive AFTER
// normalization (scheme added) — `links` holds the raw resume form so the
// harness exercises normalization end to end.

import corpus from "./resume-corpus.json";

export interface CorpusLinks {
  linkedin?: string;
  github?: string;
  portfolio?: string;
}

export interface ResumeGroundTruth {
  id: string;
  archetype: string;
  fullName: string;
  expectedFirst: string;
  /** "" means the resume has no separable surname (mononym) — excluded from last-name scoring. */
  expectedLast: string;
  email: string;
  phone: string;
  address: string;
  /** Links as written on the resume (may lack a scheme). */
  links: CorpusLinks;
  /** Links as they should be filled into a URL field (scheme-normalized). */
  expectedLinks: CorpusLinks;
}

export const RESUME_CORPUS: ResumeGroundTruth[] = corpus as ResumeGroundTruth[];
