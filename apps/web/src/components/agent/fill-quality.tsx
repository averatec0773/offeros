import type { FillStats } from "@offeros/autofill";
import type { FailureCause } from "@offeros/autofill";

/**
 * How well the fill engine is doing, across every application.
 *
 * The headline is coverage of the fields the engine could reasonably have
 * filled — NOT fields filled over fields seen. That second figure counts a
 * guard refusing a demographic question, and a file only a person can upload,
 * as failures, which would make weakening a guard the fastest way to improve
 * the score. Those two are shown beside the number instead, so nothing is
 * hidden and nothing is mis-blamed.
 *
 * Everything here is arithmetic over reports the engine already writes. No
 * model runs to produce this panel.
 */

const CAUSE_LABELS: Record<FailureCause, string> = {
  "only-you-can-answer": "Only you can answer",
  "needs-your-answer": "Waiting on you",
  "write-rejected": "Page refused the value",
  "not-recognised": "Not recognised",
  "manual-upload": "Manual upload",
};

/** Causes that are the system working. Shown, but never as a problem. */
const EXPECTED: FailureCause[] = ["only-you-can-answer", "manual-upload"];

export function FillQuality({ stats }: { stats: FillStats }) {
  if (stats.applications === 0) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-body font-semibold text-foreground">Fill quality</h2>
        <p className="mt-1 text-caption text-muted-foreground">
          Nothing filled yet. Once you apply to something, this is where the numbers appear.
        </p>
      </section>
    );
  }

  const gap = stats.expected - stats.filled;
  const problems = stats.causes.filter((c) => !EXPECTED.includes(c.cause));
  const expectedRows = stats.causes.filter((c) => EXPECTED.includes(c.cause));

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-body font-semibold text-foreground">Fill quality</h2>
        <span className="text-caption text-muted-foreground">
          {stats.applications} application{stats.applications === 1 ? "" : "s"} · {stats.fields}{" "}
          fields seen
        </span>
      </header>

      <div className="mt-3 flex items-baseline gap-3">
        <span className="text-heading font-semibold text-foreground">{stats.coverage}%</span>
        <span className="text-caption text-muted-foreground">
          {stats.filled} of {stats.expected} fields the engine could have filled
        </span>
      </div>

      {/* One bar, in the order the causes matter: what worked, then what is
          worth fixing, then what was never ours to fill. */}
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-bg-base">
        <Segment n={stats.filled} total={stats.fields} className="bg-brand" />
        {problems.map((c) => (
          <Segment key={c.cause} n={c.fields} total={stats.fields} className="bg-warn" />
        ))}
        {expectedRows.map((c) => (
          <Segment key={c.cause} n={c.fields} total={stats.fields} className="bg-border" />
        ))}
      </div>

      {gap > 0 && (
        <div className="mt-3">
          <h3 className="text-caption font-semibold text-muted-foreground">
            The gap ({gap} field{gap === 1 ? "" : "s"})
          </h3>
          <ul className="mt-1 space-y-1">
            {problems.map((c) => (
              <li key={c.cause} className="flex items-baseline gap-2 text-caption">
                <span className="w-8 shrink-0 text-right font-medium text-foreground">
                  {c.fields}
                </span>
                <span className="text-foreground/80">{CAUSE_LABELS[c.cause]}</span>
                {c.required > 0 && (
                  <span className="text-muted-foreground">({c.required} required)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {expectedRows.length > 0 && (
        <p className="mt-2 text-caption text-muted-foreground">
          Left out of the score, because they are not the engine&rsquo;s to fill:{" "}
          {expectedRows.map((c) => `${c.fields} ${CAUSE_LABELS[c.cause].toLowerCase()}`).join(", ")}
          .
        </p>
      )}

      {stats.byAts.length > 1 && (
        <div className="mt-3 border-t border-border pt-3">
          <h3 className="text-caption font-semibold text-muted-foreground">By platform</h3>
          <ul className="mt-1 space-y-1">
            {stats.byAts.map((row) => (
              <li key={row.ats} className="flex items-baseline gap-2 text-caption">
                <span className="w-20 shrink-0 text-foreground/80">{row.ats}</span>
                <span className="font-medium text-foreground">
                  {row.expected > 0 ? Math.round((row.filled / row.expected) * 100) : 0}%
                </span>
                <span className="text-muted-foreground">
                  {row.filled}/{row.expected} · {row.applications} application
                  {row.applications === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** A share of the bar. Zero-width segments are dropped so a rounding artefact
 *  cannot show a colour for something that did not happen. */
function Segment({ n, total, className }: { n: number; total: number; className: string }) {
  if (n <= 0 || total <= 0) return null;
  return <span className={className} style={{ width: `${(n / total) * 100}%` }} />;
}
