"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, FolderPlus, X } from "lucide-react";
import type { AgentTask, Application, Campaign, FitAnalysis } from "@offeros/core";
import { api } from "@/lib/api-client";
import { ApplicationRow } from "./application-row";
import { EmptyState } from "@/components/empty-state";

export type ApplicationListRow = {
  application: Application;
  task: AgentTask | null;
  fit: FitAnalysis | null;
};

/**
 * The applications list with a selection mode for moving rows into campaigns.
 *
 * Selection is a MODE, entered explicitly ("Select") and left explicitly
 * (Cancel / after a move) — not per-row checkboxes that are always live. Two
 * reasons: rows are primarily links, and a row that both navigates and selects
 * mis-fires on the boundary; and the action bar only means something while a
 * selection exists, so the mode and the bar appear and disappear together.
 */
export function ApplicationList({
  active,
  finished,
  campaigns,
}: {
  active: ApplicationListRow[];
  finished: ApplicationListRow[];
  campaigns: Campaign[];
}) {
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const campaignNames = useMemo(
    () => new Map(campaigns.map((campaign) => [campaign.id, campaign.name])),
    [campaigns],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
    setError(null);
  };

  const moveTo = async (campaignId: string | null) => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.campaigns.assign(campaignId, [...selected]);
      exitSelection();
      // Server components own the list — re-render them rather than
      // shadow-updating a client copy that could drift.
      router.refresh();
    } catch {
      setError("Could not move the selection — is the app still running?");
    } finally {
      setBusy(false);
    }
  };

  const createAndMove = async (name: string) => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const campaign = await api.campaigns.create({ name });
      await api.campaigns.assign(campaign.id, [...selected]);
      exitSelection();
      router.refresh();
    } catch {
      setError("Could not create the campaign — is the app still running?");
    } finally {
      setBusy(false);
    }
  };

  const rowProps = (row: ApplicationListRow) => ({
    application: row.application,
    task: row.task,
    fit: row.fit,
    ...(row.application.campaignId && campaignNames.has(row.application.campaignId)
      ? { campaignName: campaignNames.get(row.application.campaignId) }
      : {}),
    ...(selecting
      ? {
          selectable: true,
          selected: selected.has(row.application.id),
          onToggleSelect: () => toggle(row.application.id),
        }
      : {}),
  });

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-body font-semibold text-muted-foreground">In progress</h2>
          {!selecting && (active.length > 0 || finished.length > 0) && (
            <button
              type="button"
              onClick={() => setSelecting(true)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-caption font-semibold text-text-secondary transition-colors hover:bg-muted"
            >
              <CheckSquare aria-hidden className="size-3.5" />
              Select
            </button>
          )}
        </div>
        {active.length === 0 ? (
          <EmptyState title="Nothing in progress" body="Every application has moved on." />
        ) : (
          active.map((row) => <ApplicationRow key={row.application.id} {...rowProps(row)} />)
        )}
      </section>

      {finished.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-body font-semibold text-muted-foreground">Finished</h2>
          {finished.map((row) => (
            <ApplicationRow key={row.application.id} {...rowProps(row)} />
          ))}
        </section>
      )}

      {selecting && (
        <SelectionBar
          count={selected.size}
          campaigns={campaigns}
          busy={busy}
          error={error}
          onMove={moveTo}
          onCreate={createAndMove}
          onCancel={exitSelection}
        />
      )}
    </div>
  );
}

/**
 * The action bar for an in-flight selection. Sticky at the bottom so it stays
 * reachable however long the list is, without covering the row being decided
 * about the way a modal would.
 */
function SelectionBar({
  count,
  campaigns,
  busy,
  error,
  onMove,
  onCreate,
  onCancel,
}: {
  count: number;
  campaigns: Campaign[];
  busy: boolean;
  error: string | null;
  onMove: (campaignId: string | null) => void;
  onCreate: (name: string) => void;
  onCancel: () => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const activeCampaigns = campaigns.filter((campaign) => campaign.status === "active");

  return (
    <div className="sticky bottom-4 z-10 rounded-2xl border border-border bg-card p-3 shadow-lg">
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-1 text-body font-semibold">{count} selected</span>

        {naming ? (
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) onCreate(name.trim());
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Campaign name"
              className="min-w-40 flex-1 rounded-xl border border-border bg-background px-3 py-1.5 text-body outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={busy || count === 0 || !name.trim()}
              className="rounded-full bg-primary px-3.5 py-1.5 text-caption font-semibold text-primary-foreground disabled:opacity-50"
            >
              Create &amp; move
            </button>
            <button
              type="button"
              onClick={() => setNaming(false)}
              className="rounded-full px-3 py-1.5 text-caption font-semibold text-text-secondary hover:bg-muted"
            >
              Back
            </button>
          </form>
        ) : (
          <>
            <span className="text-caption text-muted-foreground">Move to</span>
            {activeCampaigns.map((campaign) => (
              <button
                key={campaign.id}
                type="button"
                disabled={busy || count === 0}
                onClick={() => onMove(campaign.id)}
                className="max-w-44 truncate rounded-full border border-border px-3.5 py-1.5 text-caption font-semibold transition-colors hover:bg-muted disabled:opacity-50"
              >
                {campaign.name}
              </button>
            ))}
            <button
              type="button"
              disabled={busy || count === 0}
              onClick={() => setNaming(true)}
              className="flex items-center gap-1.5 rounded-full border border-dashed border-border px-3.5 py-1.5 text-caption font-semibold text-text-secondary transition-colors hover:bg-muted disabled:opacity-50"
            >
              <FolderPlus aria-hidden className="size-3.5" />
              New campaign
            </button>
            <button
              type="button"
              disabled={busy || count === 0}
              onClick={() => onMove(null)}
              className="rounded-full px-3.5 py-1.5 text-caption font-semibold text-text-secondary transition-colors hover:bg-muted disabled:opacity-50"
            >
              No campaign
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel selection"
              className="rounded-full p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X aria-hidden className="size-4" />
            </button>
          </>
        )}
      </div>
      {error && <p className="mt-2 px-1 text-caption text-warn">{error}</p>}
    </div>
  );
}
