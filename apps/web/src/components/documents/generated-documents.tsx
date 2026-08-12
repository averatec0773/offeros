"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { DOC_STATE_LABEL, relativeTime } from "@/lib/artifact-status";
import { inputClass } from "@/components/profile/fields";
import type { DocumentRow } from "@/server/services/document-service";
import { cn } from "@/lib/utils";

/**
 * Everything OfferOS has generated, across every application.
 *
 * The list that did not exist: a tailored résumé lived inside one application's
 * workspace, so "which of these did I actually write" had no answer short of
 * opening nineteen jobs. Rows are produced server-side (`listDocuments`) and
 * kept in local state from there — the two mutations here (rename, delete) both
 * report what landed, so the row can be updated from the response instead of
 * re-fetching the page.
 */

const KIND_LABEL: Record<DocumentRow["kind"], string> = {
  resume: "Tailored résumé",
  "cover-letter": "Cover letter",
};

export function GeneratedDocuments({ initial }: { initial: DocumentRow[] }) {
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** taskId + kind is the identity of a document everywhere in this app. */
  const keyOf = (row: DocumentRow) => `${row.taskId}:${row.kind}`;

  async function rename(row: DocumentRow) {
    const name = draftName.trim();
    if (!name) return;
    setError(null);
    setBusy(true);
    try {
      const saved = await api.documents.rename(row.taskId, row.kind, name);
      setRows((r) => r.map((x) => (keyOf(x) === keyOf(row) ? { ...x, name: saved.name } : x)));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't rename that document.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: DocumentRow) {
    setError(null);
    setBusy(true);
    try {
      const result = await api.documents.remove(row.taskId, row.kind);
      setRows((r) => r.filter((x) => keyOf(x) !== keyOf(row)));
      setConfirming(null);
      // Say what actually happened to the attachment, not what was predicted.
      if (result.attachmentSwitchedToOriginal) {
        setError(`Deleted ${result.name}. The fill will attach your original résumé file now.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete that document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Outside the empty-state branch on purpose: deleting the LAST document
          empties the list, and the sentence saying what that did to the fill
          attachment must not vanish with the row it was about. */}
      {error && <p className="text-caption text-foreground">{error}</p>}

      {rows.length === 0 && (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <p className="text-body font-medium text-foreground">Nothing generated yet.</p>
          <p className="mt-1 text-body-sm text-muted-foreground">
            Tailored résumés and cover letters show up here once OfferOS writes them for a job.
          </p>
          <Link
            href="/"
            className="press mt-4 inline-flex rounded-full bg-primary px-4 py-2 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
          >
            Go to your applications
          </Link>
        </div>
      )}

      {rows.map((row) => {
        const key = keyOf(row);
        return (
          <div
            key={key}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-3"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              {editing === key ? (
                <div className="flex items-center gap-2">
                  <input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    aria-label={`Rename ${row.name}`}
                    className={cn(inputClass, "w-72")}
                  />
                  <button
                    type="button"
                    disabled={busy || !draftName.trim()}
                    onClick={() => void rename(row)}
                    className="rounded-full bg-primary px-3 py-1.5 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="rounded-full border border-border px-3 py-1.5 text-caption font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <span className="truncate text-body font-medium text-foreground">{row.name}</span>
              )}
              <span className="text-caption text-muted-foreground">
                {KIND_LABEL[row.kind]} ·{" "}
                <Link
                  href={`/applications/${row.applicationId}`}
                  className="text-primary hover:underline"
                >
                  {row.company} — {row.title}
                </Link>{" "}
                · v{row.versions} · {DOC_STATE_LABEL[row.state]} · {relativeTime(row.updatedAt)}
              </span>
            </div>

            {/* While a row is being renamed its actions step aside — a Rename
                button beside an open rename field is noise, and two controls
                with the same name are worse than that. */}
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {editing === key ? null : confirming === key ? (
                <>
                  <span className="max-w-[28rem] text-caption text-foreground">
                    {row.deleteNote ? `Delete this? ${row.deleteNote}` : "Delete this document?"}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(row)}
                    className="rounded-full bg-destructive/10 px-3 py-1.5 text-caption font-semibold text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="rounded-full border border-border px-3 py-1.5 text-caption font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <Link
                    href={`/applications/${row.applicationId}/doc/${row.kind}`}
                    className="rounded-full border border-border px-3 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
                  >
                    Open in the workbench
                  </Link>
                  <a
                    href={`/api/v1/agent/tasks/${row.taskId}/artifacts/${row.kind}/pdf`}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Download className="size-4" />
                    PDF
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(null);
                      setEditing(key);
                      setDraftName(row.name);
                    }}
                    aria-label={`Rename ${row.name}`}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="size-4" />
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setConfirming(key);
                    }}
                    aria-label={`Delete ${row.name}`}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
