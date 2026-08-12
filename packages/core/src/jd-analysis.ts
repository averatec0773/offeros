import { z } from "zod";

export const COVER_LETTER_REQUIREMENTS = ["unknown", "none", "optional", "required"] as const;
export const coverLetterRequirementSchema = z.enum(COVER_LETTER_REQUIREMENTS);

/**
 * What a posting says about one fact, in three states — and the third is the
 * one that matters.
 *
 * A posting that does not mention sponsorship has not said no. Reading silence
 * as a refusal would cost someone an application they should have made, so
 * "not mentioned" is a first-class answer and the model is told to use it
 * rather than infer.
 */
export const JOB_FACT_STATES = ["stated", "denied", "not-mentioned"] as const;

export const jobFactSchema = z.object({
  state: z.enum(JOB_FACT_STATES),
  /** The posting's own words, condensed. Empty when nothing was said. */
  detail: z.string().default(""),
});

export const jobFactsSchema = z.object({
  salary: jobFactSchema,
  sponsorship: jobFactSchema,
  remote: jobFactSchema,
  deadline: jobFactSchema,
});

export const jdAnalysisSchema = z.object({
  id: z.string().min(1),
  applicationId: z.string().min(1),
  summary: z.string(),
  responsibilities: z.array(z.string()).default([]),
  requiredSkills: z.array(z.string()).default([]),
  preferredSkills: z.array(z.string()).default([]),
  matchNotes: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  coverLetterRequirement: coverLetterRequirementSchema,
  /**
   * Facts the posting either states, explicitly rules out, or never mentions.
   *
   * Optional on purpose, and not migrated: analyses stored before this existed
   * simply have no facts, which reads as "not mentioned" — the same thing they
   * always meant. Backfilling them would mean inventing a reading nobody paid
   * for.
   */
  jobFacts: jobFactsSchema.optional(),
  /** The viewpoint the user asked for on the run that produced this, if any. */
  instruction: z.string().optional(),
  createdAt: z.number(),
});

export type CoverLetterRequirement = (typeof COVER_LETTER_REQUIREMENTS)[number];
export type JobFactState = (typeof JOB_FACT_STATES)[number];
export type JobFact = z.infer<typeof jobFactSchema>;
export type JobFacts = z.infer<typeof jobFactsSchema>;
export type JdAnalysis = z.infer<typeof jdAnalysisSchema>;
