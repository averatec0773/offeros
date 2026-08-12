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
  extensionPresent = true,
  alreadyApplied = false,
  readyToSubmit = false,
  onOpenAndFill,
  onFixed,
  onApplied,
}: {
  task: PipelineTask | null;
  incidents: FillIncidentRow[];
  busy?: boolean;
  ticketCreated?: boolean;
  /** False when no browser panel answered — "we opened the page" is then the
   *  whole truth, and claiming it will be filled would be a lie. */
  extensionPresent?: boolean;
  /** The application is already marked applied. Filling again is legitimate
   *  (a portal that lost the submission, a second role) but it is not what a
   *  click on this card usually means, so it asks first. */
  alreadyApplied?: boolean;
  /** The fill finished with nothing outstanding and the task is parked at the
   *  submit gate — the moment the page had no words for. */
  readyToSubmit?: boolean;
  onOpenAndFill: () => void;
  onFixed: () => void;
  onApplied: () => void;
}) {
  const [confirmRefill, setConfirmRefill] = useState(false);
  const reports: FieldReport[] = task?.fieldReports ?? [];
  const hasFilled = reports.length > 0;
  const actionRequired = task?.applicationInfo?.status === 2 ? task.applicationInfo : null;
  const refill = () => {
    if (alreadyApplied && !confirmRefill) {
      setConfirmRefill(true);
      return;
    }
    setConfirmRefill(false);
    onOpenAndFill();
  };

  const filled = reports.filter((r) => r.outcome === "filled").length;
  const skipped = reports.filter((r) => r.outcome === "skipped").length;
  const fillable = reports.length - skipped;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      {/* The end of a clean fill. Nothing is outstanding, the form is filled,
          and the only remaining act is one OfferOS will never do: pressing
          submit. Until now the page said nothing at all here — the fill just
          stopped, and the only hint lived in a separate inbox. */}
      {readyToSubmit && !actionRequired && (
        <div className="mb-4 rounded-xl border border-brand/40 bg-brand/5 p-3">
          <p className="text-body font-semibold text-foreground">
            Everything we could fill is filled
          </p>
          <p className="mt-1 text-caption leading-relaxed text-muted-foreground">
            Go back to the page, check it over, and submit it yourself. OfferOS never presses submit
            — that stays yours.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onApplied}
              disabled={busy}
              className="rounded-full bg-primary px-3.5 py-1.5 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
            >
              I&apos;ve submitted it
            </button>
            <button
              type="button"
              onClick={refill}
              disabled={busy}
              className="rounded-full border border-border px-3.5 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              Fill it again
            </button>
          </div>
        </div>
      )}

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
          onClick={refill}
          disabled={busy}
          className="shrink-0 rounded-full border border-border px-3.5 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {hasFilled ? "Re-fill" : "Open & fill"}
        </button>
      </div>

      {/* Filling an application you have already sent used to happen silently,
          and it quietly reopened the finished record while leaving the
          application marked applied. It is a real thing to want — a portal that
          lost the submission, a second role at the same company — so it asks
          rather than refuses. */}
      {confirmRefill && (
        <div className="mt-3 rounded-xl border border-warning/40 bg-warning/5 p-3">
          <p className="text-caption leading-relaxed text-foreground">
            You&apos;ve already marked this one as submitted. Filling it again reopens it as unsent
            — the applied date and the timeline entry go with it.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={refill}
              className="rounded-full border border-border px-3 py-1 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Fill it again anyway
            </button>
            <button
              type="button"
              onClick={() => setConfirmRefill(false)}
              className="rounded-full px-3 py-1 text-caption text-muted-foreground transition-colors hover:text-foreground"
            >
              Never mind
            </button>
          </div>
        </div>
      )}

      {ticketCreated && (
        <p className="mt-2 text-caption text-muted-foreground">
          {extensionPresent
            ? "Opened on the job site — the browser panel is filling it in."
            : "Opened the job site in a new tab. Install the OfferOS browser extension and it fills the form for you."}
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
