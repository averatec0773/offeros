import type { FormMemorySummary } from "@/server/repositories/form-memory-repo";

/**
 * What the fill engine has learned it will be asked, and how often something
 * actually went wrong.
 *
 * This panel exists to answer a question that has not been answered yet:
 * whether it is worth spending model calls on analysing failed fills. That
 * decision needs three numbers that cannot be reasoned out in advance — how
 * often a fill raises a real problem, whether questions genuinely repeat across
 * employers, and how much of the apparent failure is guards working correctly
 * (which the panel above already separates out). So the numbers are collected
 * first, for free, and the expensive thing is decided afterwards with them in
 * hand.
 *
 * Nothing here is a model's opinion. Every figure is a count.
 */

const TRIGGER_LABELS: Record<string, string> = {
  "write-rejected": "A value the page refused",
  "unrecognised-required": "A required question never seen before",
  "repeat-offender": "The same question failing again elsewhere",
  "coverage-cliff": "A new form that broadly did not fill",
};

export function FormMemoryCard({ memory, fills }: { memory: FormMemorySummary; fills: number }) {
  if (memory.knownQuestions === 0) return null;

  // Per fill, not per question: the decision is "is analysing a fill worth
  // paying for", so the rate has to have fills underneath it.
  const rate = fills > 0 ? Math.round((memory.totalIncidents / fills) * 100) : 0;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-body font-semibold text-foreground">What the engine has met</h2>
        <span className="text-caption text-muted-foreground">
          {memory.knownQuestions} distinct question{memory.knownQuestions === 1 ? "" : "s"}
        </span>
      </header>

      <dl className="mt-3 grid grid-cols-3 gap-3">
        <Figure
          value={memory.recurringQuestions}
          of={memory.knownQuestions}
          label="asked more than once"
        />
        <Figure
          value={memory.failedQuestions}
          of={memory.knownQuestions}
          label="have failed at least once"
        />
        <Figure
          value={memory.totalIncidents}
          of={fills}
          label={`worth a look · ${rate}% of fills`}
        />
      </dl>

      {memory.incidents.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3">
          {memory.incidents.map((row) => (
            <li key={row.triggerId} className="flex items-baseline gap-2 text-caption">
              <span className="w-8 shrink-0 text-right font-medium text-foreground">
                {row.count}
              </span>
              <span className="text-foreground/80">
                {TRIGGER_LABELS[row.triggerId] ?? row.triggerId}
              </span>
            </li>
          ))}
        </ul>
      )}

      {memory.failuresByType.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-1.5 text-caption font-medium text-muted-foreground">
            Where fills break down — aim fixes here, not at new vendors
          </p>
          <ul className="space-y-1">
            {memory.failuresByType.slice(0, 5).map((row) => (
              <li
                key={`${row.vendor}:${row.classifiedType}`}
                className="flex items-baseline gap-2 text-caption"
              >
                <span className="w-12 shrink-0 text-right font-medium text-foreground">
                  {row.failed}/{row.seen}
                </span>
                <span className="text-foreground/80">
                  <span className="font-medium">{row.classifiedType}</span> on {row.vendor}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Figure({ value, of, label }: { value: number; of: number; label: string }) {
  return (
    <div>
      <dd className="text-body font-semibold text-foreground">
        {value}
        <span className="text-caption font-normal text-muted-foreground"> / {of}</span>
      </dd>
      <dt className="text-caption text-muted-foreground">{label}</dt>
    </div>
  );
}
