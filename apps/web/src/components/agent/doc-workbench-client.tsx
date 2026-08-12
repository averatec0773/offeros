"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Download, FileText, History } from "lucide-react";
import type { Application, ApplicationEvent, Artifact, ArtifactKind } from "@offeros/core";
import type { LineDiff } from "@/lib/diff";
import { api, isLlmNotConfigured } from "@/lib/api-client";
import { DOC_STATE_LABEL, docStatus, relativeTime } from "@/lib/artifact-status";
import { cn } from "@/lib/utils";
import { ConnectProviderNote } from "./connect-provider-note";
import { ResumeView } from "./resume-view";
import { SpendChip } from "./spend-chip";
import { TweakInput } from "./tweak-input";
import { VersionDiff } from "./version-diff";

/**
 * One document, full width, with everything you can do to it beside it.
 *
 * The application page is a record — a place to see where things stand. This
 * is the other thing entirely: a place to work on one document, where the
 * document deserves the whole column and the controls sit next to it rather
 * than under a preview squeezed into a card. Making it a route rather than a
 * panel means it has a URL, a back button, and no competition for the space.
 */

const TITLE: Record<ArtifactKind, string> = {
  resume: "Tailored résumé",
  "cover-letter": "Cover letter",
};

const BLURB: Record<ArtifactKind, string> = {
  resume: "Reorders and re-emphasises your own résumé for this posting — never invents anything.",
  "cover-letter": "Grounded in this posting and your résumé.",
};

export function DocWorkbenchClient({
  application,
  kind,
  taskId,
  initialArtifact,
  events,
}: {
  application: Application;
  kind: ArtifactKind;
  taskId: string | null;
  initialArtifact: Artifact | null;
  events: ApplicationEvent[];
}) {
  const [artifact, setArtifact] = useState<Artifact | null>(initialArtifact);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(taskId);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialArtifact?.currentVersionId ?? null,
  );
  const [generating, setGenerating] = useState(false);
  const [tweaking, setTweaking] = useState(false);
  const [diff, setDiff] = useState<LineDiff | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [showConnectBanner, setShowConnectBanner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const status = docStatus(artifact, kind, events);
  // `events` is the server snapshot from render time, so an accept made on
  // THIS page is not in it — the local flag bridges until the next server
  // render. Every path that creates a new version clears the flag.
  const shownState = accepted && status.state === "draft" ? "accepted" : status.state;
  const version =
    artifact?.versions.find((v) => v.id === selectedId) ??
    artifact?.versions.find((v) => v.id === artifact.currentVersionId) ??
    artifact?.versions[artifact.versions.length - 1] ??
    null;
  const isCurrent = !artifact || version?.id === artifact.currentVersionId;

  async function ensureTask(): Promise<string> {
    if (currentTaskId) return currentTaskId;
    const created = await api.applications.ensureTask(application.id);
    setCurrentTaskId(created.taskId);
    return created.taskId;
  }

  async function reload(id: string) {
    const data = await api.pipelineTasks.get(id);
    const next = data.artifacts.find((a) => a.kind === kind) ?? null;
    setArtifact(next);
    setSelectedId(next?.currentVersionId ?? null);
  }

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setShowConnectBanner(false);
    setAccepted(false);
    setDiff(null);
    try {
      const id = await ensureTask();
      await (kind === "resume" ? api.pipelineTasks.tailor(id) : api.pipelineTasks.coverLetter(id));
      await reload(id);
    } catch (err) {
      if (isLlmNotConfigured(err)) setShowConnectBanner(true);
      else setError("Couldn't generate that. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleAccept() {
    if (!currentTaskId) return;
    setError(null);
    try {
      await api.pipelineTasks.approveArtifact(currentTaskId, kind);
      setAccepted(true);
      setDiff(null);
    } catch {
      setError("Couldn't record that. Please try again.");
    }
  }

  async function handleDownloadPdf() {
    if (!currentTaskId || pdfBusy) return;
    setPdfBusy(true);
    setError(null);
    try {
      const response = await fetch(api.artifacts.pdfUrl(currentTaskId, kind));
      if (!response.ok) throw new Error("render failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${kind}.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      setError("Couldn't render the PDF. The document itself is fine — try again.");
    } finally {
      setPdfBusy(false);
    }
  }

  const other: ArtifactKind = kind === "resume" ? "cover-letter" : "resume";

  return (
    <main className="mx-auto w-full max-w-[1120px] px-6 py-6">
      <nav className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/applications/${application.id}`}
          className="inline-flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            {application.jobInfo.companyName} · {application.jobInfo.jobTitle}
          </span>
        </Link>

        <div className="inline-flex overflow-hidden rounded-full ring-1 ring-inset ring-border">
          {(["resume", "cover-letter"] as const).map((value) => (
            <Link
              key={value}
              href={`/applications/${application.id}/doc/${value}`}
              aria-current={value === kind ? "page" : undefined}
              className={cn(
                "px-3.5 py-1.5 text-caption font-semibold transition-colors",
                value === kind
                  ? "bg-primary text-primary-foreground"
                  : "bg-card text-foreground hover:bg-muted",
              )}
            >
              {value === "resume" ? "Résumé" : "Cover letter"}
            </Link>
          ))}
        </div>
      </nav>

      <header className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-heading font-semibold text-foreground">{TITLE[kind]}</h1>
        <span className="text-caption text-muted-foreground">
          {shownState === "none"
            ? DOC_STATE_LABEL.none
            : `${DOC_STATE_LABEL[shownState]} · v${status.version} · ${relativeTime(status.updatedAt)}`}
        </span>
      </header>

      {showConnectBanner && <ConnectProviderNote message="Connect your AI provider to generate" />}
      {error && <p className="mt-3 text-caption text-destructive">{error}</p>}

      {!artifact || !version ? (
        <section className="mt-4 rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <FileText aria-hidden className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-2 text-title font-semibold text-foreground">Nothing here yet</p>
          <p className="mx-auto mt-1 max-w-[420px] text-body text-muted-foreground">
            {BLURB[kind]}
          </p>
          <div className="mt-4 flex justify-center">
            <SpendChip
              onClick={() => void handleGenerate()}
              label="Generate"
              busyLabel="Generating…"
              busy={generating}
              variant="primary"
            />
          </div>
        </section>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
          {/* The document gets the room. */}
          <article className="min-w-0 rounded-2xl border border-border bg-card p-5">
            {!isCurrent && (
              <p className="mb-3 rounded-xl bg-warn-bg px-3 py-2 text-caption text-foreground">
                Viewing v{artifact.versions.findIndex((v) => v.id === version.id) + 1} — an older
                version. The current one is v{artifact.versions.length}.
              </p>
            )}
            {kind === "resume" && version.resumeData ? (
              <ResumeView version={version} />
            ) : (
              <p className="whitespace-pre-wrap text-body-sm leading-relaxed text-foreground">
                {version.content}
              </p>
            )}
          </article>

          {/* …and everything you can do to it sits beside it. */}
          <aside className="space-y-4">
            <section className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-body font-semibold text-foreground">Change something</h2>
              {tweaking && currentTaskId ? (
                <TweakInput
                  taskId={currentTaskId}
                  kind={kind}
                  onResult={(result) => {
                    setDiff(result.diff);
                    setTweaking(false);
                    setAccepted(false);
                    setShowConnectBanner(false);
                    if (currentTaskId) void reload(currentTaskId);
                  }}
                  onCancel={() => setTweaking(false)}
                  onError={(err) => isLlmNotConfigured(err) && setShowConnectBanner(true)}
                />
              ) : (
                <>
                  <p className="mt-1 text-caption text-muted-foreground">
                    Say what to change in plain language — &ldquo;make it shorter&rdquo;,
                    &ldquo;lead with the ML work&rdquo;.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <SpendChip onClick={() => setTweaking(true)} label="Revise" variant="primary" />
                    <SpendChip
                      onClick={() => void handleGenerate()}
                      label="Start over"
                      busyLabel="Generating…"
                      busy={generating}
                      variant="quiet"
                    />
                  </div>
                </>
              )}
            </section>

            {diff && (
              <div className="rounded-2xl border border-border bg-card p-4">
                <h2 className="mb-2 text-body font-semibold text-foreground">What changed</h2>
                <VersionDiff diff={diff} />
              </div>
            )}

            <section className="rounded-2xl border border-border bg-card p-4">
              <h2 className="text-body font-semibold text-foreground">This version</h2>
              {version.instruction && (
                <p className="mt-1 text-caption text-muted-foreground">
                  Asked for: &ldquo;{version.instruction}&rdquo;
                </p>
              )}
              {version.rationale ? (
                <p className="mt-2 text-caption leading-relaxed text-foreground/85">
                  {version.rationale}
                </p>
              ) : (
                <p className="mt-2 text-caption text-muted-foreground">
                  No reasoning was recorded for this version.
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleAccept()}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  <Check aria-hidden className="size-3.5" />
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadPdf()}
                  disabled={pdfBusy}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <Download aria-hidden className="size-3.5" />
                  {pdfBusy ? "Rendering…" : "PDF"}
                </button>
                {shownState === "accepted" && (
                  <span className="text-caption text-success">Accepted</span>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-4">
              <h2 className="flex items-center gap-1.5 text-body font-semibold text-foreground">
                <History aria-hidden className="size-4" />
                History
              </h2>
              <ul className="mt-2 space-y-1">
                {[...artifact.versions].reverse().map((entry, i) => {
                  const number = artifact.versions.length - i;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(entry.id)}
                        aria-current={entry.id === version.id ? "true" : undefined}
                        className={cn(
                          "flex w-full items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-caption transition-colors hover:bg-muted",
                          entry.id === version.id && "bg-muted font-semibold",
                        )}
                      >
                        <span className="min-w-0 truncate text-foreground">
                          v{number}
                          {entry.instruction ? ` · ${entry.instruction}` : " · first pass"}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {relativeTime(entry.createdAt)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {/* Read-only on purpose: there is no rollback endpoint, and
                  inventing one here would put a second writer on the artifact
                  that the generation path knows nothing about. */}
              <p className="mt-2 px-2 text-caption text-muted-foreground">
                Older versions are readable, not restorable — revise the current one instead.
              </p>
            </section>

            <Link
              href={`/applications/${application.id}/doc/${other}`}
              className="block rounded-2xl border border-border bg-card px-4 py-3 text-center text-caption font-medium text-foreground transition-colors hover:bg-muted"
            >
              {other === "resume" ? "Work on the résumé →" : "Work on the cover letter →"}
            </Link>
          </aside>
        </div>
      )}
    </main>
  );
}
