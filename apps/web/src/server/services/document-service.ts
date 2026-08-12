import {
  ARTIFACT_NAME_MAX,
  artifactName,
  type Application,
  type Artifact,
  type ArtifactKind,
} from "@offeros/core";
import type { Db } from "../db/client";
import {
  deleteArtifact,
  getArtifact,
  listAllArtifacts,
  upsertArtifact,
} from "../repositories/artifact-repo";
import { getPipelineTask, listPipelineTasks } from "../repositories/pipeline-task-repo";
import {
  getApplication,
  listApplications,
  updateApplication,
} from "../repositories/application-repo";
import { appendEvent, listEvents } from "../repositories/application-event-repo";
import { listResumes } from "./resume-service";
import { resolveEffectiveResume } from "../pipeline/steps/grounding";
import { docStatus, type DocState } from "@/lib/artifact-status";

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

/** One generated document, as the Documents page shows it. */
export interface DocumentRow {
  taskId: string;
  applicationId: string;
  kind: ArtifactKind;
  name: string;
  company: string;
  title: string;
  versions: number;
  state: DocState;
  /** When the current version was produced (not when it was renamed). */
  updatedAt: number;
  /**
   * What deleting this document would do to the next fill, when that is
   * something more than "this document is gone". Same sentence the delete
   * itself reports, from the same function — a confirmation that promises
   * something different from what happens is worse than no confirmation.
   */
  deleteNote?: string;
}

/**
 * Every generated document, newest change first.
 *
 * Rows are assembled here rather than in the page because two readers need the
 * same shape: the Documents page and the agent's `list_documents`. Deriving the
 * state through `docStatus` is not a detail either — accepting a document is an
 * EVENT, so "accepted" is a comparison between the newest approval and the
 * current version's timestamp, and a second implementation of that would
 * eventually disagree with the workbench.
 */
export function listDocuments(db: Db): DocumentRow[] {
  const tasksById = new Map(listPipelineTasks(db).map((t) => [t.id, t]));
  const applicationsById = new Map(listApplications(db).map((a) => [a.id, a]));
  const eventsByApplication = new Map<string, ReturnType<typeof listEvents>>();
  const rows: DocumentRow[] = [];

  for (const artifact of listAllArtifacts(db)) {
    const task = tasksById.get(artifact.taskId);
    const application = task ? applicationsById.get(task.applicationId) : undefined;
    // An artifact whose task or application is gone is not shown: every action
    // on the row (open the workbench, follow the job) needs an application, and
    // a row that cannot be acted on is a dead end, not information.
    if (!task || !application) continue;

    let events = eventsByApplication.get(application.id);
    if (!events) {
      events = listEvents(db, application.id);
      eventsByApplication.set(application.id, events);
    }
    const status = docStatus(artifact, artifact.kind, events);
    const note = deleteNoteFor(db, application, artifact.kind);
    rows.push({
      taskId: artifact.taskId,
      applicationId: application.id,
      kind: artifact.kind,
      name: artifactName(artifact, application.jobInfo.companyName),
      company: application.jobInfo.companyName,
      title: application.jobInfo.jobTitle,
      versions: artifact.versions.length,
      state: status.state,
      updatedAt: status.updatedAt || artifact.updatedAt,
      ...(note ? { deleteNote: note } : {}),
    });
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * What losing this document costs the next fill.
 *
 * Only the tailored résumé has a consequence worth a sentence: the fill
 * attaches either the tailored PDF or the original file, and with the tailored
 * one deleted the panel would fetch a 404 and report "no file available".
 * Rather than leave that trap, the delete flips the application back to the
 * original file — but only when there IS one, because promising a fallback that
 * does not exist is the same lie in the other direction.
 */
function deleteNoteFor(db: Db, application: Application, kind: ArtifactKind): string | undefined {
  if (kind !== "resume") return undefined;
  // Absent means "tailored": that is what the fill bundle and the application
  // page both default to.
  if ((application.attachResume ?? "tailored") !== "tailored") return undefined;
  const original = resolveEffectiveResume(application, listResumes(db));
  return original?.hasFile
    ? `This application attaches the tailored résumé. Deleting it switches the attachment to your original file (${original.name}).`
    : "This application attaches the tailored résumé, and there is no uploaded file to fall back on — the next fill will have no résumé to attach until you generate one again.";
}

/**
 * Delete one generated document, and keep the fill honest about it.
 *
 * Goes through the service rather than a bare DELETE for two reasons: the
 * timeline should record that a document the user paid to generate is gone, and
 * the attachment preference may have to move with it.
 */
export function deleteDocument(
  db: Db,
  taskId: string,
  kind: ArtifactKind,
): { name: string; note?: string; attachmentSwitchedToOriginal: boolean } {
  const artifact = getArtifact(db, taskId, kind);
  if (!artifact) throw new DocumentError("no such document");
  const task = getPipelineTask(db, taskId);
  const application = task ? getApplication(db, task.applicationId) : null;
  const name = nameOf(db, artifact);
  const note = application ? deleteNoteFor(db, application, kind) : undefined;

  deleteArtifact(db, taskId, kind);

  let switched = false;
  if (application && kind === "resume" && (application.attachResume ?? "tailored") === "tailored") {
    const original = resolveEffectiveResume(application, listResumes(db));
    if (original?.hasFile) {
      updateApplication(db, application.id, { attachResume: "original" });
      switched = true;
    }
  }
  if (application) {
    appendEvent(db, {
      applicationId: application.id,
      kind: "document-deleted",
      payload: { kind, name, ...(switched ? { attachResume: "original" } : {}) },
    });
  }
  return { name, ...(note ? { note } : {}), attachmentSwitchedToOriginal: switched };
}
