import type { FieldReport } from "./fill";

/**
 * What happened to one application, as a line a person can read.
 *
 * Applying to a lot of jobs produces a specific kind of forgetting: three days
 * later you cannot remember which of them you actually filled, what you put in
 * them, or whether you ever pressed submit. Everything needed to answer that is
 * already stored — per-field reports, timestamps, a status — but the list shows
 * only a step number, so the answer is three clicks away per job.
 *
 * This turns what is on disk into the sentence the list should have been
 * showing all along. No new storage; the tracking was always happening, it was
 * just never surfaced.
 */

export type TrackingStage =
  /** OfferOS has the job but has never touched a form for it. */
  | "not-started"
  /** A form was filled at least once and the application is still open. */
  | "filled"
  /** The user said they submitted it. */
  | "submitted";

export interface ApplicationTracking {
  stage: TrackingStage;
  /** Fields written on the last fill, and how many were in play. */
  filledFields: number;
  totalFields: number;
  /** Fields still waiting on the user — the reason to come back. */
  needsUser: number;
  /** When the form was last filled, and when it was submitted. */
  lastFilledAt?: number;
  submittedAt?: number;
}

export interface TrackingInput {
  status: string;
  appliedAt?: number;
  updatedAt: number;
  fieldReports?: FieldReport[];
}

export function trackApplication(input: TrackingInput): ApplicationTracking {
  const reports = input.fieldReports ?? [];
  const filledFields = reports.filter((r) => r.outcome === "filled").length;
  const needsUser = reports.filter(
    (r) => r.outcome === "needs-user" || r.outcome === "failed",
  ).length;
  // Skipped controls were never questions; counting them would make every form
  // look half-finished.
  const totalFields = reports.filter((r) => r.outcome !== "skipped").length;

  const submitted = input.status === "applied";
  const stage: TrackingStage = submitted
    ? "submitted"
    : reports.length > 0
      ? "filled"
      : "not-started";

  return {
    stage,
    filledFields,
    totalFields,
    needsUser,
    // A fill has no timestamp of its own; the task's updatedAt is the closest
    // honest answer, and it only means anything once a fill has happened.
    ...(reports.length > 0 ? { lastFilledAt: input.updatedAt } : {}),
    ...(submitted && input.appliedAt ? { submittedAt: input.appliedAt } : {}),
  };
}

/** The line for a list row. Deliberately short — the detail is one click away. */
export function describeTracking(tracking: ApplicationTracking): string {
  switch (tracking.stage) {
    case "not-started":
      return "Not started";
    case "filled":
      return tracking.needsUser > 0
        ? `Filled ${tracking.filledFields}/${tracking.totalFields} · ${tracking.needsUser} need you`
        : `Filled ${tracking.filledFields}/${tracking.totalFields}`;
    case "submitted":
      return tracking.totalFields > 0
        ? `Submitted · filled ${tracking.filledFields}/${tracking.totalFields}`
        : "Submitted";
  }
}
