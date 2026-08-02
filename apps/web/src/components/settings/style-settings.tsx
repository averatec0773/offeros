"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { StyleMemoryKind, StyleMemorySetting } from "@/server/repositories/style-memory-repo";

const STYLE_MEMORY_MAX_CHARS = 2000;

const KINDS: StyleMemoryKind[] = ["resume", "cover-letter"];

const KIND_LABEL: Record<StyleMemoryKind, string> = {
  resume: "Résumé",
  "cover-letter": "Cover letter",
};

function Section({
  kind,
  row,
  draft,
  busy,
  onDraftChange,
  onSave,
  onClear,
  onToggleEnabled,
}: {
  kind: StyleMemoryKind;
  row: StyleMemorySetting;
  draft: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  onToggleEnabled: (next: boolean) => void;
}) {
  return (
    <div
      role="group"
      aria-label={KIND_LABEL[kind]}
      className="rounded-2xl border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-body font-semibold text-foreground">{KIND_LABEL[kind]}</h3>
        <label className="flex items-center gap-2 text-caption font-medium text-muted-foreground">
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
          />
          Enabled
        </label>
      </div>

      {row.updatedAt !== null && (
        <p className="mt-1 text-caption text-muted-foreground">
          {`${row.sourceCount > 0 ? `Learned from ${row.sourceCount} approvals` : "Edited manually"} · updated ${new Date(row.updatedAt).toLocaleString()}`}
        </p>
      )}

      <textarea
        aria-label={`${KIND_LABEL[kind]} style notes`}
        value={draft}
        maxLength={STYLE_MEMORY_MAX_CHARS}
        onChange={(e) => onDraftChange(e.target.value)}
        rows={5}
        className="mt-3 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-body text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />

      <div className="mt-2 flex items-center justify-between">
        <span className="text-caption text-muted-foreground">
          {`${draft.length}/${STYLE_MEMORY_MAX_CHARS}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="inline-flex items-center rounded-full bg-muted px-3 py-1.5 text-caption font-medium text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="inline-flex items-center rounded-full bg-primary px-3.5 py-1.5 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function StyleSettings() {
  const [settings, setSettings] = useState<StyleMemorySetting[] | null>(null);
  const [drafts, setDrafts] = useState<Record<StyleMemoryKind, string>>({
    resume: "",
    "cover-letter": "",
  });
  const [busy, setBusy] = useState<Record<StyleMemoryKind, boolean>>({
    resume: false,
    "cover-letter": false,
  });
  const [loadError, setLoadError] = useState<string | null>(null);

  function load() {
    setLoadError(null);
    api.settings.style
      .list()
      .then((list) => {
        setSettings(list);
        setDrafts({
          resume: list.find((r) => r.kind === "resume")?.notes ?? "",
          "cover-letter": list.find((r) => r.kind === "cover-letter")?.notes ?? "",
        });
      })
      .catch(() => setLoadError("Couldn't load style settings."));
  }

  useEffect(() => {
    load();
  }, []);

  async function saveNotes(kind: StyleMemoryKind) {
    setBusy((b) => ({ ...b, [kind]: true }));
    try {
      setSettings(await api.settings.style.update(kind, { notes: drafts[kind] }));
    } catch {
      setLoadError("Couldn't save. Try again.");
    } finally {
      setBusy((b) => ({ ...b, [kind]: false }));
    }
  }

  async function clearNotes(kind: StyleMemoryKind) {
    setBusy((b) => ({ ...b, [kind]: true }));
    try {
      const result = await api.settings.style.update(kind, { notes: "" });
      setSettings(result);
      setDrafts((d) => ({ ...d, [kind]: "" }));
    } catch {
      setLoadError("Couldn't clear. Try again.");
    } finally {
      setBusy((b) => ({ ...b, [kind]: false }));
    }
  }

  async function toggleEnabled(kind: StyleMemoryKind, next: boolean) {
    const prev = settings;
    setSettings((s) => s?.map((r) => (r.kind === kind ? { ...r, enabled: next } : r)) ?? s);
    try {
      setSettings(await api.settings.style.update(kind, { enabled: next }));
    } catch {
      setSettings(prev);
      setLoadError("Couldn't save. Try again.");
    }
  }

  if (!settings) {
    if (loadError) {
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-caption text-destructive">{loadError}</p>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center rounded-full bg-muted px-3 py-1.5 text-caption font-medium text-muted-foreground transition-colors hover:bg-secondary"
          >
            Retry
          </button>
        </div>
      );
    }
    return <p className="text-body text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-caption text-muted-foreground">
        OfferOS learns your style preferences from your tweaks — never companies, titles, or facts.
        Edit or clear anytime.
      </p>

      {loadError && <p className="text-caption text-destructive">{loadError}</p>}

      {KINDS.map((kind) => {
        const row = settings.find((r) => r.kind === kind);
        if (!row) return null;
        return (
          <Section
            key={kind}
            kind={kind}
            row={row}
            draft={drafts[kind]}
            busy={busy[kind]}
            onDraftChange={(value) => setDrafts((d) => ({ ...d, [kind]: value }))}
            onSave={() => saveNotes(kind)}
            onClear={() => clearNotes(kind)}
            onToggleEnabled={(next) => toggleEnabled(kind, next)}
          />
        );
      })}
    </div>
  );
}
