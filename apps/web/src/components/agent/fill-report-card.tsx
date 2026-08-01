import { CheckCircle2, XCircle } from "lucide-react";
import type { FieldReport } from "@offeros/core";

/** Live per-field fill trace: ✓ filled (source/value) and ✗ needs attention (reason). */
export function FillReportCard({ reports }: { reports: FieldReport[] }) {
  if (reports.length === 0) return null;

  const filled = reports.filter((r) => r.outcome === "filled");
  const notFilled = reports.filter((r) => r.outcome !== "filled");

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

      {notFilled.length > 0 && (
        <div className="mt-3 rounded-xl bg-warn-bg p-3">
          <h4 className="text-caption font-semibold text-foreground">
            Needs attention ({notFilled.length})
          </h4>
          <ul className="mt-1.5 space-y-1.5">
            {notFilled.map((r) => (
              <li
                key={`${r.page ?? ""}-${r.fieldId}`}
                className="flex items-start gap-1.5 text-body text-foreground"
              >
                <XCircle className="mt-0.5 size-4 shrink-0 text-warn" />
                <span>
                  <span className="font-medium">{r.label}</span>
                  <span className="text-foreground/75"> — {r.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
