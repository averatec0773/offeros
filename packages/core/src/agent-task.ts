import { z } from "zod";
import { coverLetterRequirementSchema } from "./jd-analysis";
import { fieldReportSchema } from "./fill";

/** The 7 pipeline milestones the agent moves an application through. */
export const PIPELINE_STEPS = [
  { key: "tailor-resume", label: "Generate Custom Resume" },
  { key: "confirm-resume", label: "Confirm Custom Resume" },
  { key: "analyze-site", label: "Analyze Application Site" },
  { key: "generate-cover-letter", label: "Generate Cover Letter" },
  { key: "confirm-cover-letter", label: "Confirm Cover Letter" },
  { key: "fill-form", label: "Fill out application form" },
  { key: "submit", label: "Submit Application" },
] as const;

export const AGENT_TASK_STATUSES = [
  "queued",
  "running",
  "paused",
  "awaiting_user",
  "done",
  "failed",
] as const;

/** 1 = ready to submit, 2 = action required (missingFields populated). */
export const applicationInfoSchema = z.object({
  status: z.union([z.literal(1), z.literal(2)]),
  filledFields: z.array(z.string()).default([]),
  missingFields: z.array(z.string()).optional(),
  totalFields: z.array(z.string()).optional(),
});

export const agentTaskSchema = z.object({
  id: z.string().min(1),
  applicationId: z.string().min(1),
  status: z.enum(AGENT_TASK_STATUSES),
  step: z.number().int().min(0).max(PIPELINE_STEPS.length),
  applicationInfo: applicationInfoSchema.optional(),
  resumeId: z.string().optional(),
  coverLetterId: z.string().optional(),
  coverLetterRequirement: coverLetterRequirementSchema.default("unknown"),
  skippedCoverLetter: z.boolean().default(false),
  /** Started via the extension's instant fill: the task was parked directly at
   *  fill-form without running the generation steps, which render as skipped
   *  (never as done) in the timeline. Optional (absent = false) so existing
   *  rows and constructed tasks stay valid unchanged. */
  fillFirst: z.boolean().optional(),
  fieldReports: z.array(fieldReportSchema).default([]),
  failureReason: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type ApplicationInfo = z.infer<typeof applicationInfoSchema>;
export type AgentTask = z.infer<typeof agentTaskSchema>;
export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];
export type PipelineStepKey = (typeof PIPELINE_STEPS)[number]["key"];
