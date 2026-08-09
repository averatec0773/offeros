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
  /** Parked at the form and nothing has filled it yet — the user has to open
   *  the panel on that page. Nothing moves on its own here. */
  | "open-to-fill"
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
  "open-to-fill": 1,
  "ready-to-submit": 2,
  failed: 3,
  "not-started": 4,
};

function stepKey(task: AgentTask): string {
  return PIPELINE_STEPS[task.step]?.key ?? "";
}

function itemFor(application: Application, task: AgentTask | undefined): AttentionItem | null {
  const base = {
    applicationId: application.id,
    jobTitle: application.jobInfo.jobTitle,
    companyName: application.jobInfo.companyName,
    // The task is what moves; the application row does not change when a step
    // completes, so ordering on it would put the most recent event last.
    at: task?.updatedAt ?? application.updatedAt,
  };

  // A task that exists but has never run is exactly as unstarted as no task:
  // the JD-import seam creates one up front, and those applications would
  // otherwise be invisible in the console.
  if (!task || task.status === "queued") {
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
    // No report at all means no fill has ever run. Nothing is "moving on its
    // own" here — the extension only fills once the user opens the panel on
    // that apply page, so this is their turn.
    if (!task.applicationInfo) {
      return { ...base, kind: "open-to-fill", headline: "Open the page to fill it" };
    }
    // Status 2 is the Action-Required contract: fields the fill could not
    // answer. Status 1 means everything landed and the browser (not the user)
    // holds it — that one, and only that one, is excluded.
    if (task.applicationInfo.status === 2) {
      const missing = task.applicationInfo.missingFields ?? [];
      const shown = missing.slice(0, 4);
      return {
        ...base,
        kind: "missing-fields",
        headline: `${missing.length} field${missing.length === 1 ? "" : "s"} need you`,
        // Say when the list is trimmed, so the count and the names agree.
        detail:
          missing.length > shown.length
            ? `${shown.join(", ")} +${missing.length - shown.length} more`
            : shown.join(", ") || undefined,
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
  // listAgentTasks is newest-first, so a plain Map build would leave the OLDEST
  // task per application winning — the console would report a superseded run,
  // nondeterministically when two share a timestamp.
  const tasks = new Map<string, AgentTask>();
  for (const task of listAgentTasks(db)) {
    if (!tasks.has(task.applicationId)) tasks.set(task.applicationId, task);
  }
  return listApplications(db)
    .filter((a) => a.status === "saved" || a.status === "applying")
    .map((a) => itemFor(a, tasks.get(a.id)))
    .filter((i): i is AttentionItem => i !== null)
    .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || b.at - a.at);
}
