import { ARTIFACT_NAME_MAX, artifactName, type Artifact, type ArtifactKind } from "@offeros/core";
import type { Db } from "../db/client";
import { getArtifact, upsertArtifact } from "../repositories/artifact-repo";
import { getPipelineTask } from "../repositories/pipeline-task-repo";
import { getApplication } from "../repositories/application-repo";
import { appendEvent } from "../repositories/application-event-repo";

/**
 * Generated documents, as assets rather than as steps of one application.
 *
 * The artifacts table is keyed by task and kind, which is exactly right for the
 * pipeline and useless for the question a person actually asks — "where is that
 * résumé I made for the Acme job". This service is the other view: names,
 * renames, and (in the Documents page) a list across every application.
 *
 * Names are resolved, never assumed. `artifactName` derives the default from
 * the artifact's own creation date, so a document written before names existed
 * reads with the same name it would have been given — no migration, and no
 * write on a read path.
 */

export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentError";
  }
}

/** The company an artifact's document belongs to — what its default name is
 *  built from. Empty when the trail to the application is broken, which
 *  `artifactName` handles by naming it after no company at all. */
function companyOf(db: Db, artifact: Pick<Artifact, "taskId">): string {
  const task = getPipelineTask(db, artifact.taskId);
  if (!task) return "";
  return getApplication(db, task.applicationId)?.jobInfo.companyName ?? "";
}

/** The name to show for one artifact: stored, or the default derived from what
 *  it was generated for. */
export function nameOf(db: Db, artifact: Artifact): string {
  return artifactName(artifact, companyOf(db, artifact));
}

/**
 * Trim a user-supplied name into something storable, or refuse.
 *
 * Refusals are exceptions here rather than values because this is a validation
 * boundary with one caller (the PATCH route), which turns them into a 400 —
 * unlike the agent's tools, where a failure is something a policy must reason
 * about.
 */
export function normalizeDocumentName(raw: unknown): string {
  if (typeof raw !== "string") throw new DocumentError("name is required");
  // Path separators would ride into the download's filename; control characters
  // would ride into a header. Neither is a name anyone typed on purpose.
  const cleaned = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/[/\\]/g, "")
    .trim();
  if (cleaned === "") throw new DocumentError("name cannot be empty");
  if (cleaned.length > ARTIFACT_NAME_MAX) {
    throw new DocumentError(`name cannot be longer than ${ARTIFACT_NAME_MAX} characters`);
  }
  return cleaned;
}

/**
 * Rename one document. Returns the artifact as stored, so the caller shows the
 * name that actually landed rather than the one it sent.
 */
export function renameDocument(
  db: Db,
  taskId: string,
  kind: ArtifactKind,
  rawName: string,
): { artifact: Artifact; name: string } {
  const name = normalizeDocumentName(rawName);
  const artifact = getArtifact(db, taskId, kind);
  if (!artifact) throw new DocumentError("no such document");
  const previous = nameOf(db, artifact);
  // `updatedAt` is left alone: renaming a document does not change the
  // document, and a rename that reordered the Documents list by "recently
  // updated" would be lying about what happened to the contents.
  const saved = upsertArtifact(db, { ...artifact, name });
  const task = getPipelineTask(db, taskId);
  if (task) {
    appendEvent(db, {
      applicationId: task.applicationId,
      kind: "document-renamed",
      payload: { kind, from: previous, to: name },
    });
  }
  return { artifact: saved, name };
}
