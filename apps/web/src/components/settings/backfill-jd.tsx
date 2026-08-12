"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api-client";

/**
 * Re-fetch descriptions for jobs that never got one.
 *
 * Here rather than on the applications list because it is maintenance, not
 * daily work — and because it is the one control in the app that makes a burst
 * of outbound requests. It is a button, never a schedule: nothing in OfferOS
 * should quietly contact every employer someone has applied to.
 *
 * It reports per application, including why each failure failed. Some jobs
 * simply cannot be read from a server — the page is built in the browser and
 * has no API behind it — and saying so is more useful than a bare count.
 */
export function BackfillJd() {
  const [missing, setMissing] = useState<number | null>(null);
  const [cap, setCap] = useState(25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{
    filled: number;
    failed: number;
    results: { id: string; job: string; ok: boolean; detail: string }[];
  } | null>(null);

  useEffect(() => {
    api.applications
      .backfillCount()
      .then((count) => {
        setMissing(count.missing);
        setCap(count.cap);
      })
      .catch(() => setMissing(null));
  }, []);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const result = await api.applications.backfillJd();
      setReport(result);
      setMissing(Math.max(0, (missing ?? 0) - result.filled));
    } catch {
      setError("Couldn't run that. Is the app still running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="text-body font-semibold text-foreground">Missing job descriptions</h2>
      <p className="mt-1 text-body text-muted-foreground">
        {missing === null
          ? "Checking…"
          : missing === 0
            ? "Every tracked job has a description."
            : `${missing} tracked job${missing === 1 ? " has" : "s have"} no description saved. ` +
              `Fetching them again tries the job board's own listing first, then the page itself.`}
      </p>

      {missing !== null && missing > 0 && (
        <>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-caption font-semibold text-primary-foreground press hover:bg-primary/85 disabled:opacity-50"
          >
            <RefreshCw aria-hidden className="size-3.5" />
            {busy ? "Fetching…" : `Fetch up to ${Math.min(missing, cap)}`}
          </button>
          <p className="mt-2 text-caption text-muted-foreground">
            Contacts each job&apos;s posting once. Nothing here calls your AI provider.
          </p>
        </>
      )}

      {error && <p className="mt-2 text-caption text-destructive">{error}</p>}

      {report && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-caption font-semibold text-foreground">
            {report.filled} filled · {report.failed} could not be read
          </p>
          <ul className="mt-2 space-y-1">
            {report.results.map((entry) => (
              <li key={entry.id} className="text-caption">
                <span className={entry.ok ? "text-success" : "text-warning"}>
                  {entry.ok ? "✓" : "!"}
                </span>{" "}
                <span className="text-foreground">{entry.job}</span>{" "}
                <span className="text-muted-foreground">— {entry.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
