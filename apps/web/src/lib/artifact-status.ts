import type { ApplicationEvent, Artifact, ArtifactKind } from "@offeros/core";

/**
 * What state a generated document is in, in the three words a person uses.
 *
 * "Accepted" is not a flag on the artifact — accepting appends a timeline
 * event, which is the right place for it (it is something that happened, at a
 * time). So the state is derived, and derived in one place, because the
 * materials card and the workbench must never disagree about whether a
 * document has been accepted.
 *
 * The subtlety worth getting right: revising an accepted document makes it a
 * draft again. An acceptance is of a VERSION, not of a document, so an
 * approval older than the current version says nothing about it.
 */

export type DocState = "none" | "draft" | "accepted";

export interface DocStatus {
  state: DocState;
  /** 1-based, counting every version ever produced. 0 when there are none. */
  version: number;
  /** When the current version was produced. 0 when there is none. */
  updatedAt: number;
  /** The reason the model gave for the current version, when it gave one. */
  rationale: string;
}

export function docStatus(
  artifact: Artifact | null | undefined,
  kind: ArtifactKind,
  events: readonly ApplicationEvent[],
): DocStatus {
  if (!artifact || artifact.versions.length === 0) {
    return { state: "none", version: 0, updatedAt: 0, rationale: "" };
  }
  const currentIndex = artifact.versions.findIndex((v) => v.id === artifact.currentVersionId);
  const index = currentIndex === -1 ? artifact.versions.length - 1 : currentIndex;
  const current = artifact.versions[index]!;

  const approvedAt = events
    .filter(
      (event) =>
        event.kind === "artifact-approved" &&
        (event.payload as { kind?: unknown } | undefined)?.kind === kind,
    )
    .reduce((latest, event) => Math.max(latest, event.at), 0);

  return {
    state: approvedAt >= current.createdAt && approvedAt > 0 ? "accepted" : "draft",
    version: index + 1,
    updatedAt: current.createdAt,
    rationale: current.rationale ?? "",
  };
}

export const DOC_STATE_LABEL: Record<DocState, string> = {
  none: "Not generated",
  draft: "Draft",
  accepted: "Accepted",
};

/** "3 days ago" / "just now" — the same phrasing the rest of the record uses. */
export function relativeTime(at: number, now: number = Date.now()): string {
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.round(months / 12)}y ago`;
}
