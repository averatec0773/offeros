import { z } from "zod";

export const fitAnalysisSchema = z.object({
  id: z.string().min(1),
  applicationId: z.string().min(1),
  version: z.number().int().default(1),
  overall: z.number().min(0).max(100),
  label: z.string().catch(""),
  subScores: z
    .object({
      experience: z.number().min(0).max(100).catch(0),
      skills: z.number().min(0).max(100).catch(0),
      education: z.number().min(0).max(100).catch(0),
    })
    .catch({ experience: 0, skills: 0, education: 0 }),
  whyMatch: z.string().catch(""),
  alignedSkills: z.array(z.object({ skill: z.string(), evidence: z.string().catch("") })).catch([]),
  notAlignedSkills: z
    .array(z.object({ skill: z.string(), advice: z.string().catch("") }))
    .catch([]),
  createdAt: z.number(),
});

export type FitAnalysis = z.infer<typeof fitAnalysisSchema>;
