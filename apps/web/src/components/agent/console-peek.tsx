"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Circle, ListChecks, X, XCircle } from "lucide-react";
import { api } from "@/lib/api-client";
import { subscribeToAgentEvents } from "@/lib/agent-events";
import type { AttentionItem, AttentionKind } from "@/server/services/attention-service";
import type { TraceEntry } from "@/server/agent/types";

/**
 * The run queue, the "what needs me" inbox, and the agent's activity — folded
 * behind a chip so the agent page can be the chat and nothing else.
 *
 * They used to sit stacked under the chat, pushing it down; the owner asked for
 * a focused conversation with these one click away. The chip shows the count
 * that matters ("N waiting"); the overlay carries the full console. Both halves
 * refresh on the push channel while open, so it is never a stale snapshot.
 */

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

export function ConsolePeek({
  initialInbox,
  initialTrace,
}: {
  initialInbox: AttentionItem[];
  initialTrace: TraceEntry[];
}) {
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState(initialInbox);
  const [trace, setTrace] = useState(initialTrace);
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
  // Only subscribe while the console is open — the chat page doesn't need this
  // channel churning when nobody's looking at the inbox.
  useEffect(() => {
    if (!open) return;
    void refresh();
    return subscribeToAgentEvents(null, () => void refresh());
  }, [open, refresh]);

  // Escape closes — an overlay that only closes by mouse is a trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-caption font-semibold text-foreground press hover:bg-muted"
      >
        <ListChecks aria-hidden className="size-3.5 text-muted-foreground" />
        Console
        {inbox.length > 0 && (
          <span className="rounded-full bg-warn/15 px-1.5 text-micro font-semibold text-warn">
            {inbox.length}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Agent console"
          className="animate-overlay-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/30 p-6 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="animate-panel-in my-6 w-full max-w-[720px] space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-body-lg font-semibold text-foreground">Console</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close console"
                className="rounded-full bg-card press p-2 text-muted-foreground shadow hover:bg-muted"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>

            <section className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-body font-semibold text-muted-foreground">Needs you</h3>
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
                          className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 press hover:bg-muted"
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
              <h3 className="text-body font-semibold text-muted-foreground">What the agent did</h3>
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
                      <span className="shrink-0 text-caption text-muted-foreground">
                        {entry.tool}
                      </span>
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
        </div>
      )}
    </>
  );
}
