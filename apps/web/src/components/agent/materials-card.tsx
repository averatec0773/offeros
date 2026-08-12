import Link from "next/link";
import { ArrowUpRight, FileText } from "lucide-react";
import type { ApplicationEvent, Artifact, ArtifactKind } from "@offeros/core";
import { DOC_STATE_LABEL, docStatus, relativeTime } from "@/lib/artifact-status";
import { cn } from "@/lib/utils";
import { SpendChip } from "./spend-chip";

/**
 * The two documents, as two lines.
 *
 * They used to be two full cards on this page, each with a preview, a version
 * picker, a diff and four buttons — a workbench wedged into a column beside
 * the record it was supposed to summarise. The deep work moved to its own
 * route, so what belongs here is what a record should say: which documents
 * exist, what state they are in, and how to get to them.
 */

const ROWS: { kind: ArtifactKind; label: string }[] = [
  { kind: "resume", label: "Résumé" },
  { kind: "cover-letter", label: "Cover letter" },
];

export function MaterialsCard({
  applicationId,
  artifacts,
  events,
  generating,
  onGenerate,
}: {
  applicationId: string;
  artifacts: Artifact[];
  events: ApplicationEvent[];
  /** Which document is mid-generation, if any. */
  generating: ArtifactKind | null;
  onGenerate: (kind: ArtifactKind) => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-1.5 text-body font-semibold text-foreground">
        <FileText aria-hidden className="size-4" />
        Materials
      </h2>

      <ul className="mt-2 divide-y divide-border">
        {ROWS.map(({ kind, label }) => {
          const artifact = artifacts.find((a) => a.kind === kind) ?? null;
          const status = docStatus(artifact, kind, events);
          return (
            <li key={kind} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-body font-medium text-foreground">{label}</p>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  <span
                    className={cn(
                      status.state === "accepted" && "font-medium text-success",
                      status.state === "draft" && "text-foreground",
                    )}
                  >
                    {DOC_STATE_LABEL[status.state]}
                  </span>
                  {status.state !== "none" && (
                    <>
                      {" "}
                      · v{status.version} · {relativeTime(status.updatedAt)}
                    </>
                  )}
                </p>
              </div>

              {status.state === "none" ? (
                <SpendChip
                  onClick={() => onGenerate(kind)}
                  label="Generate"
                  busyLabel="Generating…"
                  busy={generating === kind}
                  className="py-1"
                />
              ) : (
                <Link
                  href={`/applications/${applicationId}/doc/${kind}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  Open
                  <ArrowUpRight aria-hidden className="size-3.5" />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
