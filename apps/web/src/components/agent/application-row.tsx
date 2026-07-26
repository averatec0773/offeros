import Link from "next/link";
import { PIPELINE_STEPS, type Application, type AgentTask, type FitAnalysis } from "@offeros/core";
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
        {actionRequired ? (
          <span className="flex items-center gap-1.5 rounded-full bg-warn-bg px-3 py-1 text-caption font-semibold">
            <span className="size-1.5 rounded-full bg-warn" />
            Action Required
          </span>
        ) : (
          <span className="text-caption text-muted-foreground">
            {task ? `${task.step} / ${PIPELINE_STEPS.length}` : "Not started"}
          </span>
        )}
        {fit ? <FitBadge fit={fit} /> : null}
        {jobInfo.displayScore !== undefined ? (
          <MatchScoreRing score={jobInfo.displayScore} />
        ) : null}
      </div>
    </Link>
  );
}
