import { CalendarClock, CalendarPlus, CheckCircle2, Clock, Hourglass, Search } from "lucide-react";
import type { JdAnalysis } from "@offeros/core";
import { relativeTime } from "@/lib/artifact-status";
import { cn } from "@/lib/utils";

/**
 * When things happened to this application, on one line.
 *
 * Only what we actually know. `publishTimeDesc` is shown verbatim because it
 * is descriptive text scraped from the posting ("3 days ago", "Posted last
 * week") — reformatting it would mean parsing a phrase into a date and being
 * wrong sometimes. A field we never captured is simply absent; a deadline the
 * posting never stated says so rather than being computed from anything.
 */

/** Descriptive freshness phrases that plainly mean "a while ago". Deliberately
 *  narrow: a phrase we cannot read confidently gets no staleness note at all,
 *  because a wrong "this may be stale" is worse than a missing one. */
const STALE_PHRASE = /\b(\d+)\+?\s*(month|months|mo)\b|\b([3-9]\d|\d{3,})\+?\s*days?\b/i;

export function isLikelyStale(publishTimeDesc: string | undefined): boolean {
  if (!publishTimeDesc) return false;
  return STALE_PHRASE.test(publishTimeDesc);
}

interface Item {
  icon: typeof Clock;
  label: string;
  value: string;
  tone?: "muted" | "warn";
}

export function ApplicationMetaRow({
  createdAt,
  publishTimeDesc,
  appliedAt,
  lastCheckedAt,
  analysis,
}: {
  createdAt: number;
  publishTimeDesc?: string;
  appliedAt?: number;
  lastCheckedAt?: number;
  analysis: JdAnalysis | null;
}) {
  const deadline = analysis?.jobFacts?.deadline;
  const items: Item[] = [
    { icon: CalendarPlus, label: "Added", value: relativeTime(createdAt) },
    ...(publishTimeDesc
      ? [{ icon: CalendarClock, label: "Posted", value: publishTimeDesc } as Item]
      : []),
    ...(appliedAt
      ? [{ icon: CheckCircle2, label: "Applied", value: relativeTime(appliedAt) } as Item]
      : []),
    ...(lastCheckedAt
      ? [{ icon: Search, label: "Checked", value: relativeTime(lastCheckedAt) } as Item]
      : []),
    // Only ever what the posting itself stated. Nothing here is inferred, and
    // there is no field to type one in — a made-up deadline is worse than none.
    ...(deadline
      ? [
          {
            icon: Hourglass,
            label: "Deadline",
            value: deadline.state === "stated" ? deadline.detail || "stated" : "not stated",
            tone: deadline.state === "stated" ? "warn" : "muted",
          } as Item,
        ]
      : []),
  ];

  return (
    <div className="mt-3 border-t border-border pt-3">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {items.map((item) => (
          <li
            key={item.label}
            className={cn(
              "flex items-center gap-1.5 text-caption",
              item.tone === "warn" ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <item.icon aria-hidden className="size-3.5 shrink-0" />
            <span className="text-muted-foreground">{item.label}</span>
            <span className={cn(item.tone === "warn" ? "font-medium text-foreground" : "")}>
              {item.value}
            </span>
          </li>
        ))}
      </ul>

      {isLikelyStale(publishTimeDesc) && (
        <p className="mt-2 flex items-center gap-1.5 text-caption text-muted-foreground">
          <Clock aria-hidden className="size-3.5 shrink-0" />
          This posting has been up a while — worth checking it is still open.
        </p>
      )}
    </div>
  );
}
