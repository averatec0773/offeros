"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Play, Pause, List, Settings } from "lucide-react";

type AgentState = "standby-empty" | "standby-queued" | "running" | "paused" | "action-required";

/** One row of the queue popover — an application the agent knows about. */
export type QueueJob = {
  id: string;
  title: string;
  company: string;
  status: string;
  /** The application whose workspace is currently open. */
  current?: boolean;
};

type AgentStatusBarProps = {
  state: AgentState;
  jobCount: number;
  /** Optional handler for the primary Start/Pause button. Omit to render it inert. */
  onAction?: () => void;
  /** Applications shown by the list button; empty/omitted renders an empty state. */
  queue?: QueueJob[];
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
        message:
          jobCount > 0
            ? `Applying… ${jobCount} in the queue.`
            : "Applying… working through your queue.",
        action: "pause" as const,
      };
    case "paused":
      return {
        dot: "bg-warn",
        label: "Paused",
        message: jobCount > 0 ? `Paused — ${jobCount} waiting. Start to resume.` : "Paused.",
        action: "start" as const,
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

export function AgentStatusBar({ state, jobCount, onAction, queue }: AgentStatusBarProps) {
  const c = config(state, jobCount);
  const [listOpen, setListOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the queue popover on any outside click.
  useEffect(() => {
    if (!listOpen) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setListOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [listOpen]);

  return (
    <div ref={rootRef} className="relative">
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
            aria-expanded={listOpen}
            onClick={() => setListOpen((v) => !v)}
            className="inline-flex size-8 items-center justify-center rounded-full text-primary-foreground/70 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            <List className="size-4.5" />
          </button>
          <Link
            href="/settings"
            aria-label="Settings"
            className="inline-flex size-8 items-center justify-center rounded-full text-primary-foreground/70 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            <Settings className="size-4.5" />
          </Link>
        </div>
      </div>

      {listOpen && (
        <div className="absolute right-2 top-full z-20 mt-2 w-80 rounded-2xl border border-border bg-background p-2 shadow-lg">
          {queue && queue.length > 0 ? (
            <ul className="max-h-72 space-y-0.5 overflow-y-auto">
              {queue.map((job) => (
                <li key={job.id}>
                  <Link
                    href={`/applications/${job.id}`}
                    onClick={() => setListOpen(false)}
                    className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 transition-colors hover:bg-muted ${
                      job.current ? "bg-muted" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-body-sm font-medium text-foreground">
                        {job.title}
                      </span>
                      <span className="block truncate text-caption text-muted-foreground">
                        {job.company}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                      {job.current ? "current" : job.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-caption text-muted-foreground">
              No applications yet — add a job to begin.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
