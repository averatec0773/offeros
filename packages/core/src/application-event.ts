import { z } from "zod";

/**
 * A bookkeeping log entry for an application: one row per notable pipeline
 * occurrence (task started, a step completed, an artifact approved or
 * tweaked, a fill reported, the application marked submitted). `kind` is a
 * plain string (not an enum) so new event kinds are additive — old rows and
 * old readers never break as the set of kinds grows. `payload` is a tolerant
 * bag of extra detail, shaped per-kind by convention rather than a schema.
 */
export const applicationEventSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  kind: z.string(),
  at: z.number(),
  payload: z.record(z.unknown()).optional(),
});

export type ApplicationEvent = z.infer<typeof applicationEventSchema>;
