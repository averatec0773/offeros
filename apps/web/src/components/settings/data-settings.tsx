"use client";

import { useState } from "react";
import { Download } from "lucide-react";

/**
 * Data backup.
 *
 * The whole job search lives in one local SQLite file. This lets the user pull
 * a portable copy of it — keys stripped — so a new laptop or a bad disk does
 * not erase everything. The download streams from the export route; the button
 * reflects progress and any failure rather than silently doing nothing.
 */
export function DataSettings() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/data/export");
      if (!res.ok) throw new Error(`export failed (${res.status})`);
      const blob = await res.blob();
      // Prefer the filename the server set; fall back to a dated default.
      const disposition = res.headers.get("content-disposition") ?? "";
      const named = /filename="([^"]+)"/.exec(disposition)?.[1];
      const filename = named ?? `offeros-backup-${new Date().toISOString().slice(0, 10)}.db`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't build the backup. Is the app still running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-body font-semibold text-foreground">Back up your data</h2>
        <p className="mt-1 text-body text-muted-foreground">
          Download a portable copy of everything OfferOS holds — your profile, applications, saved
          answers, generated documents, and history. Your API key is never included.
        </p>
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy}
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
        >
          <Download aria-hidden className="size-4" />
          {busy ? "Preparing…" : "Download backup"}
        </button>
        {error && <p className="mt-2 text-caption text-destructive">{error}</p>}
      </div>

      <div className="rounded-2xl border border-border bg-background p-4">
        <h2 className="text-body font-semibold text-foreground">Restore on another machine</h2>
        <p className="mt-1 text-body text-muted-foreground">
          The backup is a standard SQLite database file. To restore it, quit OfferOS and replace{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-caption">~/.offeros/offeros.db</code>{" "}
          with the downloaded file, then start OfferOS again. One-click restore from the app is
          coming later.
        </p>
        <p className="mt-2 text-caption text-muted-foreground">
          The original résumé and template files you uploaded live beside the database (under{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-caption">~/.offeros/resumes</code> and{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-caption">~/.offeros/templates</code>);
          copy those folders too for a complete move. Your saved résumé text is inside the backup
          regardless.
        </p>
      </div>
    </div>
  );
}
