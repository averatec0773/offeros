import { Play, Pause, List, Settings } from "lucide-react";

type AgentState = "standby-empty" | "standby-queued" | "running" | "action-required";

type AgentStatusBarProps = {
  state: AgentState;
  jobCount: number;
  /** Optional handler for the primary Start/Pause button. Omit to render it inert. */
  onAction?: () => void;
};

function config(state: AgentState, jobCount: number) {
  switch (state) {
    case "standby-empty":
      return {
        dot: "bg-brand",
        label: "Standby",
        message: "0 Jobs Added. Add Jobs To Begin.",
        action: "start" as const,
      };
    case "standby-queued":
      return {
        dot: "bg-brand",
        label: "Standby",
        message: `${jobCount} Jobs Added. Awaiting Application Start.`,
        action: "start" as const,
      };
    case "running":
      return {
        dot: "bg-brand",
        label: "Running",
        message: "Applying… working through your queue.",
        action: "pause" as const,
      };
    case "action-required":
      return {
        dot: "bg-warn",
        label: "Action Required",
        message: "Fill in Missing Fields",
        action: "pause" as const,
      };
  }
}

export function AgentStatusBar({ state, jobCount, onAction }: AgentStatusBarProps) {
  const c = config(state, jobCount);

  return (
    <div className="flex items-center gap-3 rounded-full bg-primary py-2 pl-4 pr-2 text-primary-foreground">
      <div className="flex shrink-0 items-center gap-2">
        <span className={`size-2 rounded-full ${c.dot}`} />
        <span className="text-body font-semibold">{c.label}</span>
      </div>

      <div className="min-w-0 flex-1 truncate text-center text-body text-primary-foreground/70">
        {c.message}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onAction}
          disabled={!onAction}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground px-3.5 py-1.5 text-body font-semibold text-primary transition-colors hover:bg-primary-foreground/90 disabled:cursor-default disabled:opacity-60"
        >
          {c.action === "start" ? (
            <>
              <Play className="size-4 fill-current" />
              Start
            </>
          ) : (
            <>
              <Pause className="size-4 fill-current" />
              Pause
            </>
          )}
        </button>
        <button
          type="button"
          aria-label="Job list"
          className="inline-flex size-8 items-center justify-center rounded-full text-primary-foreground/70 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
        >
          <List className="size-4.5" />
        </button>
        <button
          type="button"
          aria-label="Settings"
          className="inline-flex size-8 items-center justify-center rounded-full text-primary-foreground/70 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
        >
          <Settings className="size-4.5" />
        </button>
      </div>
    </div>
  );
}
