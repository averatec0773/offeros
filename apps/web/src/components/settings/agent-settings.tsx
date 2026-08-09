"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "@/lib/api-client";
import type { AgentSettings } from "@offeros/core";

/**
 * How much the agent may do without stopping for you.
 *
 * Auto-submit is the only setting here that spends something you cannot get
 * back, so it is written as a decision rather than a toggle: off by default,
 * with the consequence stated next to it. Everything OfferOS does before that
 * point is reversible — a bad résumé version is regenerated, a wrong answer is
 * edited, a mis-click is undone. A sent application is not.
 */
export function AgentSettingsSection() {
  const [all, setAll] = useState<Awaited<ReturnType<typeof api.settings.get>> | null>(null);
  const settings = all?.agent ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.settings
      .get()
      .then(setAll)
      .catch(() => setError("Couldn't load your agent settings."));
  }, []);

  const update = async (patch: Partial<AgentSettings>) => {
    if (!all || !settings || busy) return;
    const previous = all;
    const next = { ...all, agent: { ...settings, ...patch } };
    setAll(next); // optimistic
    setBusy(true);
    setError(null);
    try {
      await api.settings.save(next);
    } catch {
      setAll(previous);
      setError("Couldn't save that.");
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <p className="text-body text-muted-foreground">{error ?? "Loading your agent settings…"}</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={settings.autoConfirm}
            onChange={(e) => void update({ autoConfirm: e.target.checked })}
            className="mt-1 size-4"
          />
          <span>
            <span className="block text-body font-semibold text-foreground">
              Approve generated drafts automatically
            </span>
            <span className="block text-body text-muted-foreground">
              Skip the review stops for the résumé and cover letter. You can still edit or
              regenerate either one afterwards.
            </span>
          </span>
        </label>
      </div>

      <div className="rounded-2xl border border-warn bg-warn-bg/40 p-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={settings.autoSubmit}
            onChange={(e) => void update({ autoSubmit: e.target.checked })}
            className="mt-1 size-4"
          />
          <span>
            <span className="flex items-center gap-1.5 text-body font-semibold text-foreground">
              <AlertTriangle aria-hidden className="size-4 text-warn" />
              Submit applications without asking me
            </span>
            <span className="block text-body text-foreground/80">
              OfferOS will press submit on the application site itself.
            </span>
            <span className="mt-2 block text-caption leading-relaxed text-muted-foreground">
              A sent application cannot be recalled, edited, or withdrawn — companies see exactly
              what went in, including anything OfferOS answered for you. Everything before this
              point is reversible; this is the one step that is not. Leave it off unless you have
              checked how OfferOS fills your usual application sites.
            </span>
          </span>
        </label>
      </div>

      {error && <p className="text-caption text-destructive">{error}</p>}
    </div>
  );
}
