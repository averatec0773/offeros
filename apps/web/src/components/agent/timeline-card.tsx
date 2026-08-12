"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { ApplicationEvent } from "@offeros/core";

/** Humanized labels for the pipeline step keys — deliberately distinct from
 *  `PIPELINE_STEPS`' title-case labels (e.g. "Generate Custom Resume"); the
 *  timeline reads as a log, so it uses the plain "Tailor resume" form. */
const STEP_LABELS: Record<string, string> = {
  "tailor-resume": "Tailor resume",
  "confirm-resume": "Confirm resume",
  "analyze-site": "Analyze site",
  "generate-cover-letter": "Generate cover letter",
  "confirm-cover-letter": "Confirm cover letter",
  "fill-form": "Fill form",
  submit: "Submit",
};

const ARTIFACT_KIND_LABEL: Record<string, string> = {
  resume: "résumé",
  "cover-letter": "cover letter",
};

/** Renders one event's payload into the exact copy the Style/Timeline spec
 *  calls for. Falls back to the raw `kind` for a future kind this build
 *  doesn't know about yet, so an unrecognized event never renders blank. */
function describeEvent(event: ApplicationEvent): string {
  const payload = event.payload ?? {};
  switch (event.kind) {
    case "task-started":
      return "Started";
    case "step-completed": {
      const step = String(payload.step ?? "");
      return `Completed: ${STEP_LABELS[step] ?? step}`;
    }
    case "artifact-tweaked": {
      const kind = ARTIFACT_KIND_LABEL[String(payload.kind)] ?? String(payload.kind);
      return `Tweaked ${kind}: "${String(payload.instruction ?? "")}"`;
    }
    case "artifact-approved": {
      const kind = ARTIFACT_KIND_LABEL[String(payload.kind)] ?? String(payload.kind);
      return `Approved ${kind}`;
    }
    case "fill-reported":
      return `Fill reported: ${String(payload.filled ?? 0)} filled · ${String(payload.needsAttention ?? 0)} need attention`;
    case "marked-submitted":
      return "Marked as submitted";
    case "style-distilled":
      return "Style preferences updated";
    case "evidence-captured": {
      const label = typeof payload.label === "string" ? payload.label : "a field";
      return `Screenshot kept: ${label}`;
    }
    case "job-checked": {
      const detail = typeof payload.detail === "string" ? payload.detail : "";
      return detail || "Checked the posting";
    }
    case "jd-analyzed":
      return "Read the job description";
    case "jd-replaced": {
      const chars = Number(payload.previousChars ?? 0);
      return chars > 0
        ? `Replaced the job description (${chars.toLocaleString()} characters discarded)`
        : "Replaced the job description";
    }
    case "fill-handoff-created":
      return "Opened the form to fill";
    case "instant-fill-started":
      return "Started filling from the browser panel";
    case "form-memory-recorded":
      return "Remembered what this form asked";
    case "submission-undone":
      return "Un-marked as submitted";
    case "repair-attempted":
      return "Looked for the application form";
    case "repair-succeeded":
      return "Found the application form";
    case "repair-failed":
      return "Couldn't find the application form";
    default:
      // A kind this build has never heard of. Better a readable guess than a
      // raw slug: "fill-handoff-created" is not a sentence anyone wrote for a
      // person to read, and every one of these used to reach the timeline
      // exactly as written.
      return event.kind.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
}

function exportEvents(applicationId: string, events: ApplicationEvent[]) {
  const blob = new Blob([JSON.stringify(events, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `offeros-events-${applicationId}.json`;
  anchor.click();
  // Defer the revoke: some browsers process the download click
  // asynchronously, and revoking the URL synchronously can race it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** How much history is worth showing unasked. A record should say what just
 *  happened; the rest is one click away. */
const RECENT = 3;

export function TimelineCard({
  applicationId,
  events,
}: {
  applicationId: string;
  events: ApplicationEvent[];
}) {
  const [showAll, setShowAll] = useState(false);
  const ordered = [...events].sort((a, b) => b.at - a.at);
  const shown = showAll ? ordered : ordered.slice(0, RECENT);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body font-semibold text-foreground">Timeline</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportEvents(applicationId, events)}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-caption font-medium text-muted-foreground transition-colors hover:bg-secondary"
          >
            <Download className="size-4" />
            Export JSON
          </button>
        </div>
      </div>

      {ordered.length === 0 ? (
        <p className="mt-3 text-caption text-muted-foreground">
          No history yet — events are recorded from now on.
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-2">
            {shown.map((event) => (
              <li key={event.id} className="flex items-baseline justify-between gap-3 text-body">
                <span className="min-w-0 break-words text-foreground">{describeEvent(event)}</span>
                <span className="shrink-0 text-caption text-muted-foreground">
                  {new Date(event.at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
          {ordered.length > RECENT && (
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              aria-expanded={showAll}
              className="mt-2 text-caption font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {showAll ? "Show less" : `Show all ${ordered.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
