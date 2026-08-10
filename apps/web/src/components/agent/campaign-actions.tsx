"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import type { Campaign } from "@offeros/core";
import { api } from "@/lib/api-client";

/** "New campaign" on the campaigns overview: one click, an inline name form,
 *  no navigation. The created campaign appears in the refreshed list. */
export function NewCampaignButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await api.campaigns.create({ name: name.trim() });
      setOpen(false);
      setName("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
      >
        <Plus className="size-4" strokeWidth={2.5} />
        New campaign
      </button>
    );
  }
  return (
    <form
      className="flex shrink-0 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Campaign name"
        className="w-52 rounded-xl border border-border bg-background px-3 py-2 text-body outline-none focus:border-primary"
      />
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="rounded-full bg-primary px-3.5 py-2 text-caption font-semibold text-primary-foreground disabled:opacity-50"
      >
        Create
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-full px-3 py-2 text-caption font-semibold text-text-secondary hover:bg-muted"
      >
        Cancel
      </button>
    </form>
  );
}

/**
 * Rename / archive / delete for one campaign.
 *
 * Delete asks twice (arm-then-confirm on the same button) because it discards
 * the grouping — though never the applications themselves; the repo detaches
 * them. Archive is the reversible sibling and is offered first.
 */
export function CampaignHeaderActions({ campaign }: { campaign: Campaign }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(campaign.name);
  const [note, setNote] = useState(campaign.note ?? "");
  const [armDelete, setArmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      after?.();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form
        className="flex shrink-0 flex-col items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          void run(
            () => api.campaigns.update(campaign.id, { name: name.trim(), note }),
            () => setEditing(false),
          );
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name"
          className="w-64 rounded-xl border border-border bg-background px-3 py-2 text-body outline-none focus:border-primary"
        />
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Note (optional)"
          className="w-64 rounded-xl border border-border bg-background px-3 py-2 text-body outline-none focus:border-primary"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-full bg-primary px-3.5 py-1.5 text-caption font-semibold text-primary-foreground disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-full px-3 py-1.5 text-caption font-semibold text-text-secondary hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-caption font-semibold text-text-secondary transition-colors hover:bg-muted"
      >
        <Pencil aria-hidden className="size-3.5" />
        Edit
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(() =>
            api.campaigns.update(campaign.id, {
              status: campaign.status === "active" ? "archived" : "active",
            }),
          )
        }
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-caption font-semibold text-text-secondary transition-colors hover:bg-muted disabled:opacity-50"
      >
        {campaign.status === "active" ? (
          <>
            <Archive aria-hidden className="size-3.5" />
            Archive
          </>
        ) : (
          <>
            <ArchiveRestore aria-hidden className="size-3.5" />
            Restore
          </>
        )}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (!armDelete) {
            setArmDelete(true);
            // Disarm on its own — a primed destructive button left behind is a
            // trap for the next stray click.
            setTimeout(() => setArmDelete(false), 4000);
            return;
          }
          void run(
            () => api.campaigns.remove(campaign.id),
            () => router.push("/campaigns"),
          );
        }}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-caption font-semibold transition-colors disabled:opacity-50 ${
          armDelete ? "bg-warn-bg text-foreground" : "text-text-secondary hover:bg-muted"
        }`}
      >
        <Trash2 aria-hidden className="size-3.5" />
        {armDelete ? "Really delete?" : "Delete"}
      </button>
    </div>
  );
}
