"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { FieldReport, PipelineTask } from "@offeros/core";
import type { FillIncidentRow } from "@/server/repositories/form-memory-repo";
import { cn } from "@/lib/utils";
import { ActionRequiredCard } from "./action-required-card";
import { FillReportCard } from "./fill-report-card";

/**
 * The form, as one card in three states.
 *
 * It used to be three: an entry panel, a field report, and a yellow
 * needs-you block — stacked, each with its own border and heading, all
 * describing the same event. Reading down the column you met the same fill
 * three times before learning anything new about it.
 *
 * One card now, and which state it is in answers the only question the user
 * has: never filled → here is the button; filled → here is how it went;
 * something needs you → that goes first, because it is the only part with a
 * deadline attached.
 *
 * Nothing about the handoff changed. The buttons call exactly what they
 * called before.
 */

/** A disclosure that stays out of the way until asked. Detail belongs on the
 *  page — this is a record — but not in the first screenful of it. */
function Disclosure({
  summary,
  count,
  children,
}: {
  summary: string;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-caption font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 transition-transform", open && "rotate-90")}
        />
        {summary}
        {count !== undefined && <span className="font-normal">({count})</span>}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function FormCard({
  task,
  incidents,
  busy = false,
  ticketCreated = false,
  onOpenAndFill,
  onFixed,
  onApplied,
}: {
  task: PipelineTask | null;
  incidents: FillIncidentRow[];
  busy?: boolean;
  ticketCreated?: boolean;
  onOpenAndFill: () => void;
  onFixed: () => void;
  onApplied: () => void;
}) {
  const reports: FieldReport[] = task?.fieldReports ?? [];
  const hasFilled = reports.length > 0;
  const actionRequired = task?.applicationInfo?.status === 2 ? task.applicationInfo : null;

  const filled = reports.filter((r) => r.outcome === "filled").length;
  const skipped = reports.filter((r) => r.outcome === "skipped").length;
  const fillable = reports.length - skipped;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      {/* Needs-you first: it is the only part of this card with a deadline. */}
      {actionRequired && (
        <div className="mb-4">
          <ActionRequiredCard
            applicationInfo={actionRequired}
            onReFill={onOpenAndFill}
            onFixed={onFixed}
            onApplied={onApplied}
          />
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-body font-semibold text-foreground">The form</h2>
          <p className="mt-0.5 text-caption text-muted-foreground">
            {hasFilled
              ? `${filled} of ${fillable} fillable fields filled${
                  skipped > 0 ? ` · ${skipped} standard fields skipped` : ""
                }`
              : "Open the application and the browser panel fills it from your profile."}
          </p>
        </div>
        {/* Secondary on purpose. The page's main entry to filling lives in the
            header, where it is visible without scrolling; this one stays
            because HERE it means something more specific — "that fill left
            nine fields, run it again" — sitting right next to the report that
            says so. Two buttons of equal weight for one action would be the
            actual problem, so this one is quiet. */}
        <button
          type="button"
          onClick={onOpenAndFill}
          disabled={busy}
          className="shrink-0 rounded-full border border-border px-3.5 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {hasFilled ? "Re-fill" : "Open & fill"}
        </button>
      </div>

      {ticketCreated && (
        <p className="mt-2 text-caption text-muted-foreground">
          Ticket created — the Side Panel will pick it up on the ATS page.
        </p>
      )}

      {hasFilled && (
        <Disclosure summary="Field by field" count={reports.length}>
          {/* The existing report, unchanged — it just no longer needs its own
              border and heading now that it lives inside this one. */}
          <div className="[&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 [&>div>h3]:sr-only">
            <FillReportCard reports={reports} />
          </div>
        </Disclosure>
      )}

      {incidents.length > 0 && (
        <Disclosure summary="What went wrong here" count={incidents.length}>
          <ul className="space-y-1.5">
            {incidents.map((incident) => (
              <li key={incident.id} className="text-caption text-muted-foreground">
                <span className="font-medium text-foreground">{incident.triggerId}</span> —{" "}
                {incident.summary}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}
