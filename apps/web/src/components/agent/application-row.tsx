"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, MessageSquare } from "lucide-react";
import { AgentChat } from "./agent-chat";
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
  campaignName,
  selectable = false,
  selected = false,
  onToggleSelect,
}: {
  application: Application;
  task: AgentTask | null;
  fit?: FitAnalysis | null;
  /** Shown as a small tag when the row belongs to a campaign. Omit on pages
   *  already scoped to one campaign — repeating the name on every row is noise. */
  campaignName?: string;
  /** Selection mode: the whole row becomes a toggle and navigation is
   *  suspended. Selecting and navigating on the same click is the classic way
   *  to lose a selection to a mis-tap, so the two modes never coexist. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [asking, setAsking] = useState(false);
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
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-body font-semibold">
        {initials(jobInfo.companyName)}
      </span>

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
    <div
      className={`rounded-2xl border bg-card ${selectable && selected ? "border-primary" : "border-border"}`}
    >
      {/* The link and the Ask button are siblings, not nested: a button inside
          a link is neither keyboard-navigable nor clickable the way either one
          promises. */}
      <div className="flex items-center gap-4 p-4">
        {selectable ? (
          <button
            type="button"
            onClick={onToggleSelect}
            aria-pressed={selected}
            aria-label={`${selected ? "Deselect" : "Select"} ${jobInfo.jobTitle} at ${jobInfo.companyName}`}
            className="flex min-w-0 flex-1 items-center gap-4 rounded-xl text-left transition hover:opacity-80"
          >
            <span
              aria-hidden
              className={`flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                selected ? "border-primary bg-primary" : "border-border bg-background"
              }`}
            >
              {selected && <Check className="size-3.5 text-primary-foreground" strokeWidth={3} />}
            </span>
            {body}
          </button>
        ) : (
          <Link
            href={`/applications/${application.id}`}
            className="flex min-w-0 flex-1 items-center gap-4 rounded-xl transition hover:opacity-80"
          >
            {body}
          </Link>
        )}

        <div className="flex shrink-0 items-center gap-3">
          {campaignName && (
            <span className="max-w-32 truncate rounded-full bg-muted px-2.5 py-1 text-caption text-muted-foreground">
              {campaignName}
            </span>
          )}
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
          {/* Asking about a job you just spotted in the list should not require
            leaving the list. Same conversation as the workspace, scoped here.
            Hidden while selecting — the row is a toggle then, and a second
            interactive affordance on a toggle invites mis-taps. */}
          {!selectable && (
            <>
              <button
                type="button"
                onClick={() => setAsking((open) => !open)}
                aria-expanded={asking}
                aria-label={`Ask about ${jobInfo.jobTitle} at ${jobInfo.companyName}`}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-caption font-semibold transition-colors ${
                  asking
                    ? "bg-primary text-primary-foreground"
                    : "text-text-secondary hover:bg-muted"
                }`}
              >
                <MessageSquare aria-hidden className="size-3.5" />
                Ask
              </button>
              <Link
                href={`/applications/${application.id}`}
                aria-label={`Open ${jobInfo.jobTitle}`}
                className="rounded-full p-1 hover:bg-muted"
              >
                <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
              </Link>
            </>
          )}
        </div>
      </div>

      {asking && (
        <div className="border-t border-border p-3">
          <AgentChat applicationId={application.id} />
        </div>
      )}
    </div>
  );
}
