"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import type { Application } from "@offeros/core";
import { api } from "@/lib/api-client";

/**
 * Add a job by pasting its link.
 *
 * The whole interaction is one field, because one field is all the app needs
 * from the user: on a platform it can read, the title, company and description
 * come from the platform itself. Anywhere else it keeps a minimal record and
 * says so, rather than asking for a form's worth of retyping up front.
 *
 * A posting already tracked is not an error — it is an answer. The dialog says
 * so and goes there.
 */
export function AddJobDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Application | null>(null);

  function close() {
    setOpen(false);
    setUrl("");
    setError(null);
    setDuplicate(null);
  }

  async function submit() {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setDuplicate(null);
    try {
      const result = await api.applications.create(trimmed);
      if (result.duplicate) {
        // Stop, and say so. Navigating straight through was the confusing half
        // of a real incident: the user saw an application open and assumed it
        // was the one they had just added, when it was one they saved weeks
        // ago. Nothing was created, and nothing said so.
        setDuplicate(result.application);
        setBusy(false);
        return;
      }
      router.push(`/applications/${result.application.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that link.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-body font-semibold text-primary-foreground press hover:bg-primary/85"
      >
        <Plus className="size-4" strokeWidth={2.5} />
        Add a job
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Add a job"
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-6 pt-[18vh] overlay-in"
      onClick={close}
    >
      <div
        className="w-full max-w-[560px] rounded-2xl border border-border bg-card p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-title font-semibold text-foreground">Add a job</h2>
            <p className="mt-1 text-body text-muted-foreground">
              Paste the link to the posting. Supported job boards fill in the details themselves.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <form
          className="mt-4 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            autoFocus
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://…"
            aria-label="Posting URL"
            disabled={busy}
            className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={busy || url.trim() === ""}
            className="shrink-0 rounded-full bg-primary px-4 py-2 text-body font-semibold text-primary-foreground press hover:bg-primary/85 disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </form>

        {duplicate && (
          <div className="mt-3 rounded-xl bg-warn-bg p-3">
            <p className="text-body font-semibold text-foreground">
              You are already tracking this job
            </p>
            <p className="mt-1 text-caption text-foreground/80">
              Nothing new was added. This link points at{" "}
              <span className="font-medium">
                {duplicate.jobInfo.jobTitle} at {duplicate.jobInfo.companyName}
              </span>
              , which is already on your list.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => router.push(`/applications/${duplicate.id}`)}
                className="rounded-full bg-primary px-3.5 py-1.5 text-caption font-semibold text-primary-foreground press hover:bg-primary/85"
              >
                Open it
              </button>
              <button
                type="button"
                onClick={() => {
                  setDuplicate(null);
                  setUrl("");
                }}
                className="rounded-full border border-border px-3.5 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Add a different link
              </button>
            </div>
          </div>
        )}
        {error && <p className="mt-2 text-caption text-destructive">{error}</p>}
      </div>
    </div>
  );
}
