import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import type { FieldReport } from "@offeros/core";
import { diagnoseFill, type CauseGroup, type FailureCause } from "@offeros/autofill";

/**
 * What the last fill did, and why it did not finish.
 *
 * The unfilled half used to be one list of every field with its raw engine
 * reason — eighteen rows on a real form, each phrased for a developer. It also
 * counted skipped controls as failures, which made a form that behaved
 * correctly look broken.
 *
 * Now it groups by cause, using the same `diagnoseFill` the agent reads. Two
 * consequences worth stating: the causes cannot disagree with what the chat
 * says about the same fill, and a person can see the four reasons without
 * opening a conversation to be told them.
 */
export function FillReportCard({ reports }: { reports: FieldReport[] }) {
  if (reports.length === 0) return null;

  const filled = reports.filter((r) => r.outcome === "filled");
  const { causes } = diagnoseFill(reports);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-body font-semibold text-foreground">Field report</h3>

      {filled.length > 0 && (
        <div className="mt-3">
          <h4 className="text-caption font-semibold text-muted-foreground">
            Filled ({filled.length})
          </h4>
          <ul className="mt-1.5 space-y-1.5">
            {filled.map((r) => (
              <li
                key={`${r.page ?? ""}-${r.fieldId}`}
                className="flex items-start gap-1.5 text-body text-foreground"
              >
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" />
                <span>
                  <span className="font-medium">{r.label}</span>
                  {r.source === "none" ? (
                    r.value && <span className="text-muted-foreground">: {r.value}</span>
                  ) : r.source === "resume-file" || r.source === "cover-letter-file" ? (
                    <span className="text-muted-foreground">
                      {" "}
                      — attached
                      {r.value ? `: ${r.value}` : ""}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {" "}
                      — {r.source}
                      {r.value ? `: ${r.value}` : ""}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {causes.map((cause) => (
        <CauseBlock key={cause.cause} group={cause} />
      ))}
    </div>
  );
}

/**
 * A cause that is working as designed reads as information, not as a warning.
 * A file picker only a person can open is not a problem to solve, and colouring
 * it like one trains the user to ignore the colour.
 */
const EXPECTED: FailureCause[] = ["manual-upload", "only-you-can-answer"];

const HEADINGS: Record<FailureCause, string> = {
  "only-you-can-answer": "Only you can answer these",
  "needs-your-answer": "Waiting on an answer from you",
  "write-rejected": "The page refused these values",
  "not-recognised": "Not recognised — fill these by hand",
  "manual-upload": "Upload these yourself",
};

function CauseBlock({ group }: { group: CauseGroup }) {
  const expected = EXPECTED.includes(group.cause);
  const Icon = expected ? Info : AlertCircle;
  return (
    <div className={`mt-3 rounded-xl p-3 ${expected ? "bg-bg-base" : "bg-warn-bg"}`}>
      <h4 className="flex items-center gap-1.5 text-caption font-semibold text-foreground">
        <Icon className={`size-4 shrink-0 ${expected ? "text-muted-foreground" : "text-warn"}`} />
        {HEADINGS[group.cause]} ({group.fields.length}
        {group.requiredCount > 0 && `, ${group.requiredCount} required`})
      </h4>
      <p className="mt-1 text-caption text-foreground/75">{group.explanation}</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {group.fields.map((field, i) => (
          <li
            key={`${field}-${i}`}
            className="rounded-full bg-background px-2 py-0.5 text-caption text-foreground"
          >
            {field}
          </li>
        ))}
      </ul>
    </div>
  );
}
