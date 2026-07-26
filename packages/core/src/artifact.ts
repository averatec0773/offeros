import { z } from "zod";
import { structuredResumeSchema } from "./resume";

export const ARTIFACT_KINDS = ["resume", "cover-letter"] as const;
export const artifactKindSchema = z.enum(ARTIFACT_KINDS);

export const artifactVersionSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
  rationale: z.string().default(""),
  changedLines: z.array(z.string()).optional(),
  createdAt: z.number(),
  resumeData: structuredResumeSchema.optional(),
});

export const artifactSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  kind: artifactKindSchema,
  versions: z.array(artifactVersionSchema).min(1),
  currentVersionId: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
