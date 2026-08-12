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
  /** Free-text instruction that produced this version via a tweak; absent for
   *  versions produced by the pipeline's own generation steps. */
  instruction: z.string().optional(),
});

export const artifactSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  kind: artifactKindSchema,
  /**
   * What the user calls this document. Optional because every artifact written
   * before names existed has none — see `artifactName`, which derives the same
   * default a new one would get, so nothing had to be migrated.
   */
  name: z.string().optional(),
  versions: z.array(artifactVersionSchema).min(1),
  currentVersionId: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;
export type Artifact = z.infer<typeof artifactSchema>;

/** How long a name may be. Long enough for "cover_Company_2026-08-12" plus a
 *  sentence of the user's own; short enough to stay a filename. */
export const ARTIFACT_NAME_MAX = 120;

const KIND_PREFIX: Record<ArtifactKind, string> = {
  resume: "resume",
  "cover-letter": "cover",
};

/**
 * Everything a filename should not have to carry: control and formatting
 * characters, the Windows-reserved set, and both path separators. Unicode
 * LETTERS are kept — a company written in Chinese is a company, and stripping
 * to ASCII would name its documents "resume__2026-08-12".
 */
const UNSAFE_IN_NAME = /[\p{Cc}\p{Cf}<>:"/\\|?*]/gu;

/** Squeeze one component (a company name) into something safe to put in a
 *  filename: no unsafe characters, no whitespace, bounded length. */
export function sanitizeNamePart(value: string, maxLength = 40): string {
  return value
    .normalize("NFC")
    .replace(UNSAFE_IN_NAME, "")
    .replace(/\s+/gu, "")
    .slice(0, maxLength)
    .replace(/^\.+|\.+$/g, "");
}

/** `resume_Acme_2026-08-12` / `cover_Acme_2026-08-12`. */
export function defaultArtifactName(kind: ArtifactKind, companyName: string, at: number): string {
  const company = sanitizeNamePart(companyName) || "job";
  const day = new Date(at).toISOString().slice(0, 10);
  return `${KIND_PREFIX[kind]}_${company}_${day}`;
}

/**
 * The name to show for a document.
 *
 * Stored name wins; otherwise the default is computed from the artifact's OWN
 * creation time, which makes it deterministic — the same artifact derives the
 * same name on every read, so documents that predate naming need no migration
 * and no write on a read path to look right.
 */
export function artifactName(
  artifact: Pick<Artifact, "kind" | "createdAt"> & { name?: string },
  companyName: string,
): string {
  const stored = artifact.name?.trim();
  return stored ? stored : defaultArtifactName(artifact.kind, companyName, artifact.createdAt);
}
