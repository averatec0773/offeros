import Link from "next/link";
import { ChevronRight } from "lucide-react";
import {
  describeTracking,
  trackApplication,
  type Application,
  type AgentTask,
  type FitAnalysis,
} from "@offeros/core";
import { MatchScoreRing } from "./match-score-ring";

function initials(company: string): string {
  return company
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}

/** STRONG/GOOD MATCH tiering (data-driven, not hardcoded per call site). */
export function fitLabelFor(overall: number): "Strong match" | "Good match" | "Needs work" {
  if (overall >= 85) return "Strong match";
  if (overall >= 70) return "Good match";
  return "Needs work";
}

function FitBadge({ fit }: { fit: FitAnalysis }) {
  const value = Math.round(fit.overall);
  const strong = value >= 70;
  return (
    <span
      data-testid="fit-badge"
      title={fitLabelFor(value)}
      className={`rounded-full px-2.5 py-1 text-caption font-semibold tabular-nums ${
        strong ? "bg-brand/10 text-foreground" : "bg-warn-bg text-foreground"
      }`}
    >
      {value}%
    </span>
  );
}

export function ApplicationRow({
  application,
  task,
  fit,
}: {
  application: Application;
  task: AgentTask | null;
  fit?: FitAnalysis | null;
}) {
  const actionRequired = task?.applicationInfo?.status === 2;
  const { jobInfo } = application;
  // What actually happened to this application, rather than which pipeline
  // step it stopped at. Applying to a lot of jobs makes "step 3 of 7"
  // meaningless three days later; "filled 23/41, 8 need you" is the thing
  // being remembered.
  const tracking = trackApplication({
    status: application.status,
    ...(application.appliedAt ? { appliedAt: application.appliedAt } : {}),
    updatedAt: task?.updatedAt ?? application.updatedAt,
    ...(task?.fieldReports ? { fieldReports: task.fieldReports } : {}),
  });

  return (
    <Link
      href={`/applications/${application.id}`}
      className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 transition hover:bg-muted"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-body font-semibold">
        {initials(jobInfo.companyName)}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-body text-muted-foreground">
          {jobInfo.companyName}
          {jobInfo.jobLocation ? ` · ${jobInfo.jobLocation}` : ""}
        </p>
        <p className="truncate text-title font-semibold">{jobInfo.jobTitle}</p>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        {/* Two different questions, so two different things on the row. The
            badge answers "does this need me"; the line answers "what happened
            here" — which is the one you cannot reconstruct three days and forty
            applications later. Showing only the badge, as this did, left the
            second question unanswerable without opening the job. */}
        <span
          className={`text-caption ${
            tracking.stage === "submitted" ? "text-success" : "text-muted-foreground"
          }`}
        >
          {describeTracking(tracking)}
        </span>
        {actionRequired && (
          <span className="flex items-center gap-1.5 rounded-full bg-warn-bg px-3 py-1 text-caption font-semibold">
            <span className="size-1.5 rounded-full bg-warn" />
            Action Required
          </span>
        )}
        {fit ? <FitBadge fit={fit} /> : null}
        {jobInfo.displayScore !== undefined ? (
          <MatchScoreRing score={jobInfo.displayScore} />
        ) : null}
        <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
      </div>
    </Link>
  );
}
