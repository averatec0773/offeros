import Link from "next/link";
import { ChevronRight, MessageSquare } from "lucide-react";
import {
  describeTracking,
  trackApplication,
  type Application,
  type PipelineTask,
  type FitAnalysis,
} from "@offeros/core";
import { CompanyAvatar } from "./company-avatar";
import { MatchScoreRing } from "./match-score-ring";

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
  hasLogo = false,
}: {
  application: Application;
  task: PipelineTask | null;
  fit?: FitAnalysis | null;
  hasLogo?: boolean;
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

  const body = (
    <>
      <CompanyAvatar
        company={jobInfo.companyName}
        {...(hasLogo ? { logoUrl: `/api/v1/applications/${application.id}/logo` } : {})}
      />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-muted-foreground">
          {jobInfo.companyName}
          {jobInfo.jobLocation ? ` · ${jobInfo.jobLocation}` : ""}
        </span>
        <span className="block truncate text-title font-semibold">{jobInfo.jobTitle}</span>
      </span>
    </>
  );

  return (
    <div className="rounded-2xl border border-border bg-card">
      {/* The link and the Ask button are siblings, not nested: a button inside
          a link is neither keyboard-navigable nor clickable the way either one
          promises. */}
      <div className="flex items-center gap-4 p-4">
        <Link
          href={`/applications/${application.id}`}
          className="flex min-w-0 flex-1 items-center gap-4 rounded-xl transition-opacity duration-150 hover:opacity-80"
        >
          {body}
        </Link>

        <div className="flex shrink-0 items-center gap-3">
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
          {/* Ask goes to the agent page carrying this job, rather than opening
            a second chat inline. One conversation, one place — the chip there
            shows which job came along, and can be taken off. */}
          <Link
            href={`/agent?application=${application.id}`}
            aria-label={`Ask about ${jobInfo.jobTitle} at ${jobInfo.companyName}`}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-caption font-semibold text-text-secondary transition-colors hover:bg-muted"
          >
            <MessageSquare aria-hidden className="size-3.5" />
            Ask
          </Link>
          <Link
            href={`/applications/${application.id}`}
            aria-label={`Open ${jobInfo.jobTitle}`}
            className="rounded-full p-1 hover:bg-muted"
          >
            <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
          </Link>
        </div>
      </div>
    </div>
  );
}
