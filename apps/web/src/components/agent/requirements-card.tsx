import { AlertTriangle, CheckCircle2, FileText, Search } from "lucide-react";
import type { RequirementsSummary } from "@/server/services/requirements-service";

/**
 * What this form will ask, and how much of it is already answered.
 *
 * Every number here is deterministic — the same answer-bank and profile
 * matching the fill engine itself does. That is the whole value: a readiness
 * figure the fill will actually deliver, rather than an encouraging guess.
 *
 * The empty state is not a failure state. "We have not looked" is a true and
 * useful thing to say, and it comes with the button that fixes it.
 */

const VERDICT_COPY: Record<string, string> = {
  open: "Still open",
  closed: "Closed",
  "suspected-closed": "Probably closed",
  unknown: "Could not tell",
};

function when(at: number): string {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(at).toLocaleDateString();
}

export function RequirementsCard({
  requirements,
  onCheck,
  onWriteCoverLetter,
  checking = false,
  hasCoverLetter = false,
}: {
  requirements: RequirementsSummary;
  onCheck: () => void;
  /** Offered only when the form has a cover-letter field and none exists yet. */
  onWriteCoverLetter?: () => void;
  checking?: boolean;
  hasCoverLetter?: boolean;
}) {
  const { source, total, required, ready, missing, freeText, needsCoverLetter } = requirements;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-body font-semibold text-foreground">What this application asks</h2>
        <span className="text-caption text-muted-foreground">
          {source === "fill"
            ? "from the real form"
            : source === "prescan"
              ? "from the job board"
              : "not checked"}
        </span>
      </header>

      {source === "none" ? (
        <div className="mt-3">
          <p className="text-body text-muted-foreground">
            Nothing known about this form yet. Checking the posting reads what it asks — and whether
            it is still open.
          </p>
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-caption font-semibold text-primary-foreground press hover:bg-primary/85 disabled:opacity-50"
          >
            <Search aria-hidden className="size-3.5" />
            {checking ? "Checking…" : "Check the posting"}
          </button>
        </div>
      ) : (
        <>
          <p className="mt-3 text-body text-foreground">
            <span className="font-semibold">
              {required} required question{required === 1 ? "" : "s"}
            </span>
            {required > 0 && (
              <span className="text-muted-foreground"> · {ready} already answered</span>
            )}
            {total > required && <span className="text-muted-foreground"> · {total} in total</span>}
          </p>

          {missing.length > 0 ? (
            <div className="mt-3 rounded-xl bg-warn-bg p-3">
              <p className="flex items-center gap-1.5 text-caption font-semibold text-foreground">
                <AlertTriangle aria-hidden className="size-3.5" />
                Needs an answer from you
              </p>
              <ul className="mt-2 space-y-1">
                {missing.map((question) => (
                  <li key={question} className="text-caption text-foreground/80">
                    {question}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            required > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-caption text-success">
                <CheckCircle2 aria-hidden className="size-3.5" />
                Every required question has an answer on file.
              </p>
            )
          )}

          {freeText > 0 && (
            <p className="mt-3 text-caption text-muted-foreground">
              {freeText} open-ended question{freeText === 1 ? "" : "s"} to write — the slow part of
              this application.
            </p>
          )}

          {needsCoverLetter && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-caption text-foreground">
                <FileText aria-hidden className="size-3.5" />
                This form has a cover-letter field.
              </span>
              {!hasCoverLetter && onWriteCoverLetter && (
                <button
                  type="button"
                  onClick={onWriteCoverLetter}
                  className="rounded-full border border-border px-3 py-1 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  Write one
                </button>
              )}
            </div>
          )}
        </>
      )}

      {(requirements.lastChecked || requirements.publishTimeDesc) && (
        <p className="mt-3 border-t border-border pt-2 text-caption text-muted-foreground">
          {requirements.lastChecked && (
            <>
              Checked {when(requirements.lastChecked.at)} ·{" "}
              <span
                className={
                  requirements.lastChecked.verdict === "closed" ||
                  requirements.lastChecked.verdict === "suspected-closed"
                    ? "font-semibold text-warning"
                    : ""
                }
              >
                {VERDICT_COPY[requirements.lastChecked.verdict] ?? requirements.lastChecked.verdict}
              </span>
            </>
          )}
          {requirements.lastChecked && requirements.publishTimeDesc && " · "}
          {requirements.publishTimeDesc && <>Posted {requirements.publishTimeDesc}</>}
        </p>
      )}
    </section>
  );
}
