import { z } from "zod";

export const APPLICATION_STATUSES = [
  "saved",
  "applying",
  "applied",
  "interview",
  "offer",
  "rejected",
  "archived",
] as const;

export const jobInfoSchema = z.object({
  jobId: z.string().min(1),
  jobTitle: z.string(),
  companyName: z.string(),
  companyStage: z.string().optional(),
  jobLocation: z.string().optional(),
  employmentType: z.string().optional(),
  jobSeniority: z.string().optional(),
  workModel: z.string().optional(),
  salaryDesc: z.string().optional(),
  publishTimeDesc: z.string().optional(),
  applyLink: z.string().optional(),
  displayScore: z.number().optional(),
});

export const ATTACH_RESUME_OPTIONS = ["tailored", "original"] as const;

export const applicationSchema = z.object({
  id: z.string().min(1),
  jobInfo: jobInfoSchema,
  status: z.enum(APPLICATION_STATUSES),
  jdText: z.string().optional(),
  notes: z.string().optional(),
  resumeId: z.string().optional(),
  attachResume: z.enum(ATTACH_RESUME_OPTIONS).optional(),
  appliedAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type JobInfo = z.infer<typeof jobInfoSchema>;
export type Application = z.infer<typeof applicationSchema>;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type AttachResume = (typeof ATTACH_RESUME_OPTIONS)[number];
