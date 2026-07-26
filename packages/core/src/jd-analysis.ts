import { z } from "zod";

export const COVER_LETTER_REQUIREMENTS = ["unknown", "none", "optional", "required"] as const;
export const coverLetterRequirementSchema = z.enum(COVER_LETTER_REQUIREMENTS);

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
  createdAt: z.number(),
});

export type CoverLetterRequirement = (typeof COVER_LETTER_REQUIREMENTS)[number];
export type JdAnalysis = z.infer<typeof jdAnalysisSchema>;
