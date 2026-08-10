"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, XCircle } from "lucide-react";
import { AgentChat } from "./agent-chat";
import { api } from "@/lib/api-client";
import { subscribeToAgentEvents } from "@/lib/agent-events";
import type { AttentionItem, AttentionKind } from "@/server/services/attention-service";
import type { TraceEntry } from "@/server/agent/types";
import { QueueBar } from "./queue-bar";
import type { QueueJob } from "./agent-status-bar";

const KIND_STYLE: Record<AttentionKind, { Icon: typeof Circle; cls: string; label: string }> = {
  "missing-fields": { Icon: AlertTriangle, cls: "text-warn", label: "Needs answers" },
  "open-to-fill": { Icon: Circle, cls: "text-brand", label: "Open to fill" },
  "ready-to-submit": { Icon: CheckCircle2, cls: "text-brand", label: "Ready" },
  failed: { Icon: XCircle, cls: "text-destructive", label: "Failed" },
  "not-started": { Icon: Circle, cls: "text-muted-foreground", label: "Not started" },
};

function timeAgo(at: number, now: number): string {
  const mins = Math.max(0, Math.round((now - at) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/**
 * The campaign console: one place that answers "what needs me?" across every
 * application, and shows what the agent has been doing. Both halves refresh on
 * the push channel, so it is never a stale snapshot.
 */
export function ConsoleClient({
  eligible,
  jobs,
  initialInbox,
  initialTrace,
}: {
  eligible: string[];
  jobs: QueueJob[];
  initialInbox: AttentionItem[];
  initialTrace: TraceEntry[];
}) {
  const [inbox, setInbox] = useState(initialInbox);
  const [trace, setTrace] = useState(initialTrace);
  // Rendered timestamps are computed from a client-owned clock, set after
  // mount: formatting "3m ago" during SSR would disagree with the browser.
  const [now, setNow] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.agent.inbox();
      setInbox(data.inbox);
      setTrace(data.trace);
      setNow(Date.now());
    } catch {
      // Keep the last known state; the next event will retry.
    }
  }, []);

  useEffect(() => {
    setNow(Date.now());
  }, []);
  useEffect(() => subscribeToAgentEvents(null, () => void refresh()), [refresh]);

  return (
    <div className="space-y-8">
      {/* First thing on the page: the conversation IS the console. The queue
          bar and inbox below say what's happening; this is where you ask why
          and tell the agent what to do about it. Scoped to every application —
          the per-application thread lives in the workspace. */}
      <AgentChat />

      <QueueBar eligible={eligible} jobs={jobs} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-body font-semibold text-muted-foreground">Needs you</h2>
          <span className="text-caption text-muted-foreground">{inbox.length} waiting</span>
        </div>
        {inbox.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
            <p className="text-body font-semibold text-foreground">Nothing needs you</p>
            <p className="mt-1 text-body text-muted-foreground">
              Every tracked application is either finished or moving on its own.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {inbox.map((item) => {
              const { Icon, cls, label } = KIND_STYLE[item.kind];
              return (
                <li key={`${item.applicationId}-${item.kind}`}>
                  <Link
                    href={`/applications/${item.applicationId}`}
                    className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-muted"
                  >
                    <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${cls}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-semibold text-foreground">
                        {item.headline}
                      </span>
                      <span className="block truncate text-caption text-muted-foreground">
                        {item.jobTitle} · {item.companyName}
                        {item.detail ? ` — ${item.detail}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground">
                      {label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-body font-semibold text-muted-foreground">What the agent did</h2>
        {trace.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-body text-muted-foreground">
            No agent activity yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {trace.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 rounded-xl px-3 py-2 text-body odd:bg-muted/40"
              >
                <span
                  aria-hidden
                  className={`size-1.5 shrink-0 rounded-full ${entry.ok ? "bg-brand" : "bg-destructive"}`}
                />
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {entry.summary}
                  {entry.failureReason ? (
                    <span className="text-muted-foreground"> — {entry.failureReason}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-caption text-muted-foreground">{entry.tool}</span>
                {entry.verified === false && (
                  <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-caption text-destructive">
                    unverified
                  </span>
                )}
                <span className="w-16 shrink-0 text-right text-caption text-muted-foreground">
                  {now === null ? "" : timeAgo(entry.at, now)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
