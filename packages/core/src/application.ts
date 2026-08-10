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
  /** The campaign this application belongs to, if any. An application belongs
   *  to AT MOST ONE campaign — a deliberate constraint, not a missing feature:
   *  a campaign is "one batch of applying", and letting a row sit in several
   *  would make every campaign count ambiguous. Revisit if a real need for
   *  cross-cutting groups appears. */
  campaignId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const CAMPAIGN_STATUSES = ["active", "archived"] as const;

/**
 * A named batch of applications the user works through together — "new-grad
 * SWE, August wave". It is NOT an execution system: running a campaign just
 * feeds its members into the existing run queue, which keeps every gate the
 * queue already enforces. A campaign only ever contributes grouping and
 * counting.
 */
export const campaignSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  note: z.string().optional(),
  status: z.enum(CAMPAIGN_STATUSES),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type JobInfo = z.infer<typeof jobInfoSchema>;
export type Application = z.infer<typeof applicationSchema>;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export type AttachResume = (typeof ATTACH_RESUME_OPTIONS)[number];
export type Campaign = z.infer<typeof campaignSchema>;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
