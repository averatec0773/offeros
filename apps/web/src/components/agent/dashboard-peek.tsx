"use client";

import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, X } from "lucide-react";

/**
 * The analysis dashboard, folded into a glance.
 *
 * The full cards (fill quality, form memory) used to sit between the page
 * header and the chat, pushing the thing the user came to DO below the fold to
 * make room for things they occasionally READ. Now the header carries a
 * one-line summary chip; clicking it opens the full cards in an overlay.
 *
 * The cards themselves stay server-rendered — they arrive as `children`, and
 * this component only decides whether they are visible. That keeps their data
 * fetching where it was and this file free of any knowledge of what a "fill
 * quality" is.
 */
export function DashboardPeek({ line, children }: { line: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);

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
        className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
      >
        <BarChart3 aria-hidden className="size-3.5 text-muted-foreground" />
        {line}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Fill analytics"
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/30 p-6 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="my-6 w-full max-w-[720px] space-y-4"
            // Clicks inside the cards must not close the overlay.
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close analytics"
                className="rounded-full bg-card p-2 text-muted-foreground shadow hover:bg-muted"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
            {children}
          </div>
        </div>
      )}
    </>
  );
}
