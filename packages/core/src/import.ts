import { z } from "zod";

const importedResumeSlot = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  targetRole: z.string().optional(),
  isPrimary: z.boolean().optional(),
  createdAt: z.number(),
});

const importedApplication = z.object({
  id: z.string(),
  company: z.string().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  status: z.string().optional(),
  jdText: z.string().optional(),
  notes: z.string().optional(),
  filledAt: z.number().optional(),
  statusUpdatedAt: z.number().optional(),
});

/** Tolerant on purpose: the legacy bundle is a reference format, not our contract. */
export const exportBundleSchema = z.object({
  schemaVersion: z.number().optional(),
  exportedAt: z.number().optional(),
  profile: z
    .object({
      personal: z.record(z.unknown()).optional(),
      education: z.array(z.record(z.unknown())).optional(),
      workExperience: z.array(z.record(z.unknown())).optional(),
      skills: z.array(z.string()).optional(),
      answerBank: z.array(z.record(z.unknown())).optional(),
    })
    .nullable()
    .optional(),
  resumes: z.array(importedResumeSlot).default([]),
  resumeBlobs: z.record(z.string()).default({}),
  applications: z.array(importedApplication).default([]),
});

export type ExportBundle = z.infer<typeof exportBundleSchema>;
