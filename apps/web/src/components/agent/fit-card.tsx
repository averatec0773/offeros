"use client";

import type { FitAnalysis } from "@offeros/core";
import { MatchScoreRing } from "./match-score-ring";
import { ConnectProviderNote } from "./connect-provider-note";
import { SpendChip } from "./spend-chip";

function SubScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="flex items-center justify-between text-caption">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums text-foreground">{pct}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function FitCard({
  fit,
  onRecompute,
  busy = false,
  llmError = false,
}: {
  fit: FitAnalysis;
  onRecompute?: () => void;
  busy?: boolean;
  /** True when the last recompute failed because no AI provider is configured. */
  llmError?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <MatchScoreRing score={fit.overall} size={64} />
        <div className="min-w-0 flex-1">
          <h3 className="text-body font-semibold text-foreground">{fit.label || "Fit score"}</h3>
          <p className="text-caption text-muted-foreground">Applicant ↔ job fit</p>
        </div>
        <SpendChip
          onClick={() => onRecompute?.()}
          label="Recompute"
          busyLabel="Recomputing…"
          busy={busy}
          className="bg-card ring-1 ring-inset ring-border"
        />
      </div>

      {llmError && <ConnectProviderNote message="Connect your AI provider to start" />}

      <div className="mt-4 space-y-3">
        <SubScoreBar label="Experience" value={fit.subScores.experience} />
        <SubScoreBar label="Skills" value={fit.subScores.skills} />
        <SubScoreBar label="Education" value={fit.subScores.education} />
      </div>

      {fit.whyMatch && <p className="mt-3 text-body text-foreground/80">{fit.whyMatch}</p>}

      {fit.alignedSkills.length > 0 && (
        <div className="mt-3">
          <h4 className="text-caption font-semibold text-muted-foreground">Aligned skills</h4>
          <ul className="mt-1.5 space-y-1.5">
            {fit.alignedSkills.map((item, i) => (
              <li key={i}>
                <span className="inline-flex items-center rounded-full bg-brand/10 px-2.5 py-1 text-caption font-semibold text-foreground">
                  {item.skill}
                </span>
                {item.evidence && (
                  <p className="mt-1 pl-1 text-caption text-muted-foreground">{item.evidence}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {fit.notAlignedSkills.length > 0 && (
        <div className="mt-3 rounded-xl bg-warn-bg p-3">
          <h4 className="text-caption font-semibold text-foreground">Not aligned</h4>
          <ul className="mt-1.5 space-y-1.5">
            {fit.notAlignedSkills.map((item, i) => (
              <li key={i}>
                <span className="inline-flex items-center rounded-full bg-card px-2.5 py-1 text-caption font-semibold text-foreground ring-1 ring-inset ring-border">
                  {item.skill}
                </span>
                {item.advice && (
                  <p className="mt-1 pl-1 text-caption text-foreground/80">{item.advice}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
