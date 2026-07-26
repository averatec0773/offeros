import { CheckCircle2, TriangleAlert } from "lucide-react";
import type { JdAnalysis } from "@offeros/core";

export function GapsCard({ analysis }: { analysis: JdAnalysis }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-body font-semibold text-foreground">JD match analysis</h3>
      <p className="mt-1.5 text-body text-muted-foreground">{analysis.summary}</p>

      {analysis.matchNotes.length > 0 && (
        <div className="mt-3">
          <h4 className="text-caption font-semibold text-muted-foreground">Strengths</h4>
          <ul className="mt-1.5 space-y-1.5">
            {analysis.matchNotes.map((note, i) => (
              <li key={i} className="flex items-start gap-1.5 text-body text-foreground">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" />
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {analysis.gaps.length > 0 && (
        <div className="mt-3 rounded-xl bg-warn-bg p-3">
          <h4 className="text-caption font-semibold text-foreground">Gaps &amp; risks</h4>
          <ul className="mt-1.5 space-y-1.5">
            {analysis.gaps.map((gap, i) => (
              <li key={i} className="flex items-start gap-1.5 text-body text-foreground">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                {gap}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
