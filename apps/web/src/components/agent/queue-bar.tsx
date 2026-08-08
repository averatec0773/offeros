"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { subscribeToAgentEvents } from "@/lib/agent-events";
import { AgentStatusBar, type QueueJob } from "./agent-status-bar";
import type { QueueStatus } from "@/server/services/queue-service";

/**
 * The homepage run-queue console: one bar that starts the batch over every
 * eligible application, pauses it, and shows live progress (SSE-refreshed).
 * The queue itself lives server-side; this is a thin, honest view of it.
 */
export function QueueBar({ eligible, jobs }: { eligible: string[]; jobs: QueueJob[] }) {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [skippedNote, setSkippedNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.queue.status());
    } catch {
      // Web app briefly unreachable — keep the last known state.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Every agent event may move the queue — refresh the bar on push.
  useEffect(() => subscribeToAgentEvents(null, () => void refresh()), [refresh]);

  const remaining = status ? status.queued.length + (status.current ? 1 : 0) : 0;
  const state =
    status?.state === "running"
      ? ("running" as const)
      : status?.state === "paused"
        ? ("paused" as const)
        : eligible.length > 0
          ? ("standby-queued" as const)
          : ("standby-empty" as const);

  const onAction = async () => {
    setSkippedNote(null);
    try {
      if (state === "running") {
        await api.queue.pause();
      } else if (eligible.length > 0 || state === "paused") {
        const res = await api.queue.start(eligible.length > 0 ? eligible : (status?.queued ?? []));
        if (res.skipped.length > 0) {
          setSkippedNote(
            `${res.skipped.length} skipped: ${res.skipped
              .slice(0, 3)
              .map((s) => s.reason)
              .join("; ")}${res.skipped.length > 3 ? "…" : ""}`,
          );
        }
      }
    } catch {
      // Action failed — the refresh below re-reads the truth.
    }
    await refresh();
  };

  const actionable = state === "running" || state === "paused" || eligible.length > 0;
  return (
    <div className="mb-6">
      <AgentStatusBar
        state={state}
        jobCount={state === "running" || state === "paused" ? remaining : eligible.length}
        onAction={actionable ? () => void onAction() : undefined}
        queue={jobs}
      />
      {skippedNote && <p className="mt-2 px-4 text-caption text-muted-foreground">{skippedNote}</p>}
    </div>
  );
}
