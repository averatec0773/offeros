"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { Artifact } from "@offeros/core";
import { api } from "@/lib/api-client";
import { ResumeView } from "./resume-view";

const KIND_LABEL: Record<Artifact["kind"], string> = {
  resume: "Résumé",
  "cover-letter": "Cover Letter",
};

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Pull the quoted filename out of a `content-disposition: attachment; filename="..."` header. */
function filenameFromContentDisposition(header: string | null, fallback: string): string {
  const match = header ? /filename="?([^";]+)"?/.exec(header) : null;
  return match?.[1] ?? fallback;
}

type ApiEnvelope = { success: boolean; errorCode: number; errorMsg: string | null };

/** Split an error message at the first blank line: short summary vs. an optional log excerpt. */
function splitError(message: string): { summary: string; detail: string | null } {
  const idx = message.indexOf("\n\n");
  if (idx === -1) return { summary: message, detail: null };
  return { summary: message.slice(0, idx), detail: message.slice(idx + 2) };
}

export function ArtifactViewer({ artifact }: { artifact: Artifact }) {
  const [selectedId, setSelectedId] = useState(artifact.currentVersionId);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfErrorExpanded, setPdfErrorExpanded] = useState(false);
  const [pdfNote, setPdfNote] = useState<string | null>(null);
  const version =
    artifact.versions.find((v) => v.id === selectedId) ??
    artifact.versions[artifact.versions.length - 1]!;

  const changedLines = useMemo(() => new Set(version.changedLines ?? []), [version.changedLines]);
  const lines = version.content.split("\n");

  async function downloadPdf() {
    setPdfBusy(true);
    setPdfError(null);
    setPdfErrorExpanded(false);
    setPdfNote(null);
    try {
      const response = await fetch(api.artifacts.pdfUrl(artifact.taskId, artifact.kind));
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiEnvelope | null;
        setPdfError(body?.errorMsg ?? `Couldn't generate the PDF (${response.status}).`);
        return;
      }
      const note = response.headers.get("x-offeros-render-note");
      if (note) setPdfNote(note);
      const filename = filenameFromContentDisposition(
        response.headers.get("content-disposition"),
        `${artifact.kind}-${version.id}.pdf`,
      );
      const blob = await response.blob();
      downloadBlob(filename, blob);
    } catch {
      setPdfError("Couldn't generate the PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  const pdfErrorParts = pdfError ? splitError(pdfError) : null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body font-semibold text-foreground">{KIND_LABEL[artifact.kind]}</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => download(`${artifact.kind}-${version.id}.txt`, version.content)}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-caption font-medium text-muted-foreground transition-colors hover:bg-secondary"
          >
            <Download className="size-4" />
            Download
          </button>
          <button
            type="button"
            onClick={downloadPdf}
            disabled={pdfBusy}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-caption font-medium text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            <Download className="size-4" />
            {pdfBusy ? "Generating…" : "Download PDF"}
          </button>
        </div>
      </div>

      {pdfNote && <p className="mt-2 text-caption text-muted-foreground">{pdfNote}</p>}

      {pdfErrorParts && (
        <div className="mt-2 text-caption text-destructive">
          <p>{pdfErrorParts.summary}</p>
          {pdfErrorParts.detail && (
            <>
              <button
                type="button"
                onClick={() => setPdfErrorExpanded((expanded) => !expanded)}
                className="mt-1 text-caption font-medium text-muted-foreground underline-offset-2 hover:underline"
              >
                {pdfErrorExpanded ? "Hide details" : "Show details"}
              </button>
              {pdfErrorExpanded && (
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-2 text-micro text-foreground">
                  {pdfErrorParts.detail}
                </pre>
              )}
            </>
          )}
        </div>
      )}

      {artifact.versions.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {artifact.versions.map((v, i) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setSelectedId(v.id)}
              aria-pressed={v.id === selectedId}
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-caption font-semibold transition-colors ${
                v.id === selectedId
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-secondary"
              }`}
            >
              v{i + 1}
            </button>
          ))}
        </div>
      )}

      {version.rationale && (
        <p className="mt-3 text-caption text-muted-foreground">{version.rationale}</p>
      )}

      {artifact.kind === "resume" && version.resumeData ? (
        <ResumeView version={version} />
      ) : (
        <pre className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted p-3 font-mono text-caption leading-relaxed text-foreground">
          {lines.map((line, i) => (
            <div key={i} className={changedLines.has(line) ? "bg-brand/15" : undefined}>
              {line.length > 0 ? line : " "}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}
