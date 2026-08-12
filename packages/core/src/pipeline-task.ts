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

export const PIPELINE_TASK_STATUSES = [
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
  /**
   * The REQUIRED questions, and the ones of those already answered.
   *
   * `totalFields` is every control the engine met, including the ones it
   * correctly left alone — on a real form, 32 skipped controls out of 73. The
   * card that reports progress talks about required fields, so it needs the
   * required population, not that one. Optional so records written before this
   * still parse; the card falls back to counting the reports it has.
   */
  requiredFields: z.array(z.string()).optional(),
  requiredFilledFields: z.array(z.string()).optional(),
});

export const pipelineTaskSchema = z.object({
  id: z.string().min(1),
  applicationId: z.string().min(1),
  status: z.enum(PIPELINE_TASK_STATUSES),
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
export type PipelineTask = z.infer<typeof pipelineTaskSchema>;
export type PipelineTaskStatus = (typeof PIPELINE_TASK_STATUSES)[number];
export type PipelineStepKey = (typeof PIPELINE_STEPS)[number]["key"];
