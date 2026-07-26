"use client";

import { Sparkles } from "lucide-react";
import type { AgentTask } from "@offeros/core";

export type GateKind = "confirm-resume" | "confirm-cover-letter" | "choice";

const TITLE: Record<GateKind, string> = {
  "confirm-resume": "Your tailored résumé is ready",
  "confirm-cover-letter": "Your cover letter is ready",
  choice: "Want a cover letter for this one?",
};

function GateButton({
  children,
  onClick,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        variant === "primary"
          ? "inline-flex items-center rounded-full bg-primary px-3.5 py-1.5 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
          : "inline-flex items-center rounded-full bg-card px-3.5 py-1.5 text-caption font-semibold text-foreground ring-1 ring-inset ring-border transition-colors hover:bg-muted"
      }
    >
      {children}
    </button>
  );
}

export function GateCard({
  task,
  kind,
  rationale,
  onApprove,
  onTweak,
  onSkip,
  onGenerate,
}: {
  task: AgentTask;
  kind: GateKind;
  rationale?: string;
  onApprove?: () => void;
  onTweak?: () => void;
  onSkip?: () => void;
  onGenerate?: () => void;
}) {
  return (
    <div className="rounded-2xl bg-warn-bg p-4" data-task-id={task.id}>
      <div className="flex items-center gap-1.5 text-body font-semibold text-foreground">
        <Sparkles className="size-4" />
        {TITLE[kind]}
      </div>

      {rationale && (
        <p className="mt-2 flex items-start gap-1.5 text-body text-foreground/80">
          <span className="mt-0.5 size-1 shrink-0 rounded-full bg-foreground/60" />
          {rationale}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {kind === "choice" ? (
          <>
            <GateButton variant="secondary" onClick={onSkip}>
              Skip
            </GateButton>
            <GateButton onClick={onGenerate}>Generate Cover Letter</GateButton>
          </>
        ) : (
          <>
            <GateButton onClick={onApprove}>Approve</GateButton>
            <GateButton variant="secondary" onClick={onTweak}>
              I Want To Tweak It
            </GateButton>
          </>
        )}
      </div>
    </div>
  );
}
