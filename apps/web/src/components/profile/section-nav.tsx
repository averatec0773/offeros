"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type SectionNavItem = { id: string; label: string };

/** Transient autosave state surfaced in the sticky nav header. */
export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Sticky scroll-nav. Clicking a tab scrolls its section into view; while
 * scrolling, an IntersectionObserver keeps the active tab in sync. Falls back
 * to click-only highlighting where IntersectionObserver is unavailable. The
 * header also carries a subtle autosave indicator (state owned by the parent).
 */
export function SectionNav({
  items,
  saveStatus = "idle",
  saveError,
  onRetry,
}: {
  items: SectionNavItem[];
  saveStatus?: SaveStatus;
  saveError?: string | null;
  onRetry?: () => void;
}) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const atBottomRef = useRef(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const lastId = items[items.length - 1]?.id;

    const observer = new IntersectionObserver(
      (entries) => {
        // Near the bottom, the last section wins (handled by onScroll below) —
        // don't let the observer pull the active tab back to an earlier section.
        if (atBottomRef.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }

    // The last section is often too short to ever reach the observer's active
    // band (the page can't scroll past its own bottom), so it would never
    // activate. When scrolled to the bottom, force the last section active.
    function onScroll() {
      const doc = document.documentElement;
      // Only when the page genuinely scrolls AND is at the bottom — a short page
      // that fits without scrolling must keep its normal (top-first) active tab.
      const scrollable = doc.scrollHeight > window.innerHeight + 4;
      const nearBottom = scrollable && window.innerHeight + window.scrollY >= doc.scrollHeight - 4;
      atBottomRef.current = nearBottom;
      if (nearBottom && lastId) setActive(lastId);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [items]);

  function go(id: string) {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <nav
        aria-label="Profile sections"
        className="flex flex-wrap gap-1.5 rounded-full border border-border bg-card p-1"
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => go(item.id)}
            aria-current={active === item.id ? "true" : undefined}
            className={cn(
              "rounded-full px-3 py-1.5 text-body font-medium transition-colors",
              active === item.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <SaveIndicator status={saveStatus} error={saveError} onRetry={onRetry} />
    </div>
  );
}

function SaveIndicator({
  status,
  error,
  onRetry,
}: {
  status: SaveStatus;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (status === "saving") {
    return (
      <span aria-live="polite" className="text-caption text-muted-foreground">
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span
        aria-live="polite"
        className="flex items-center gap-1 text-caption text-muted-foreground"
      >
        <Check className="size-3.5 text-brand" aria-hidden />
        All changes saved
      </span>
    );
  }
  if (status === "error") {
    return (
      <span aria-live="polite" className="flex items-center gap-2 text-caption">
        <span className="text-destructive">{error ?? "Couldn't save."}</span>
        <button
          type="button"
          onClick={onRetry}
          className="font-medium text-foreground underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </span>
    );
  }
  return null;
}
