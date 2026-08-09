import { PIPELINE_STEPS, type AgentTask, type Application } from "@offeros/core";
import type { Db } from "../db/client";
import { listApplications } from "../repositories/application-repo";
import { listAgentTasks } from "../repositories/agent-task-repo";

/**
 * The needs-me inbox: everything across every application that is waiting on
 * the person, in one list.
 *
 * Without this, "where am I stuck?" is answered by opening each application in
 * turn — the exact tax the competing product charges. The data is already
 * there (task state, field reports, failure reasons); this only decides what
 * counts as *your* turn and how urgent it is.
 */

export type AttentionKind =
  /** The form was filled but fields still need a human answer. */
  | "missing-fields"
  /** Everything is ready; only the user can submit. */
  | "ready-to-submit"
  /** A step failed — needs a retry or a decision. */
  | "failed"
  /** Tracked but never started. */
  | "not-started";

export interface AttentionItem {
  applicationId: string;
  jobTitle: string;
  companyName: string;
  kind: AttentionKind;
  /** One line, addressed to the user: what they have to do. */
  headline: string;
  /** Optional supporting detail (which fields, which error). */
  detail?: string;
  /** Sort key: most recently touched first within a priority band. */
  at: number;
}

// Lower number = surfaced first. Ordering is by what the user loses by
// ignoring it: an unfinished submission is a wasted application, a failure
// blocks everything after it, an unstarted job is merely not-yet-progress.
const PRIORITY: Record<AttentionKind, number> = {
  "missing-fields": 0,
  "ready-to-submit": 1,
  failed: 2,
  "not-started": 3,
};

function stepKey(task: AgentTask): string {
  return PIPELINE_STEPS[task.step]?.key ?? "";
}

function itemFor(application: Application, task: AgentTask | undefined): AttentionItem | null {
  const base = {
    applicationId: application.id,
    jobTitle: application.jobInfo.jobTitle,
    companyName: application.jobInfo.companyName,
    at: application.updatedAt,
  };

  if (!task) {
    return { ...base, kind: "not-started", headline: "Not started yet" };
  }
  if (task.status === "failed") {
    return {
      ...base,
      kind: "failed",
      headline: "A step failed",
      detail: task.failureReason,
    };
  }
  if (task.status !== "awaiting_user") return null;

  const key = stepKey(task);
  if (key === "fill-form") {
    const missing = task.applicationInfo?.missingFields ?? [];
    // Status 2 is the Action-Required contract: fields the fill could not
    // answer. Anything else at this gate is waiting on the browser, not on the
    // user, and must not be dressed up as their turn.
    if (task.applicationInfo?.status === 2) {
      return {
        ...base,
        kind: "missing-fields",
        headline:
          missing.length > 0
            ? `${missing.length} field${missing.length === 1 ? "" : "s"} need you`
            : "Some fields need you",
        detail: missing.slice(0, 4).join(", ") || undefined,
      };
    }
    return null;
  }
  if (key === "submit") {
    return { ...base, kind: "ready-to-submit", headline: "Ready to submit" };
  }
  // Confirm/choice gates are the workspace's job, not the inbox's: they are
  // review steps the user opted into, not work blocking an application.
  return null;
}

/** Everything waiting on the user, most consequential first. */
export function buildInbox(db: Db): AttentionItem[] {
  const tasks = new Map(listAgentTasks(db).map((t) => [t.applicationId, t]));
  return listApplications(db)
    .filter((a) => a.status === "saved" || a.status === "applying")
    .map((a) => itemFor(a, tasks.get(a.id)))
    .filter((i): i is AttentionItem => i !== null)
    .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || b.at - a.at);
}
