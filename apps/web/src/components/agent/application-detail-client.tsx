"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, MessageSquare, Search } from "lucide-react";
import {
  APPLICATION_STATUSES,
  type Application,
  type ApplicationEvent,
  type ApplicationStatus,
  type Artifact,
  type FitAnalysis,
  type PipelineTask,
  type ResumeSummary,
} from "@offeros/core";
import type { LineDiff } from "@/lib/diff";
import { api, isLlmNotConfigured } from "@/lib/api-client";
import type { JdAnalysis } from "@offeros/core";
import type { RequirementsSummary } from "@/server/services/requirements-service";
import type { FillIncidentRow } from "@/server/repositories/form-memory-repo";
import { extensionPresent, openFillTabViaExtension } from "@/lib/extension-bridge";
import { subscribeToAgentEvents } from "@/lib/agent-events";
import { cn } from "@/lib/utils";
import { LabeledSelect } from "@/components/profile/fields";
import { ArtifactViewer } from "./artifact-viewer";
import { ConnectProviderNote } from "./connect-provider-note";
import { FitCard } from "./fit-card";
import { FormCard } from "./form-card";
import { JdCard } from "./jd-card";
import { RequirementsCard } from "./requirements-card";
import { SpendChip } from "./spend-chip";
import { TimelineCard } from "./timeline-card";
import { TweakInput } from "./tweak-input";
import { VersionDiff } from "./version-diff";

/**
 * One application, as a record rather than a workbench.
 *
 * This page used to render a seven-step pipeline: a status bar, a Start
 * button, a timeline of steps, and gate cards asking permission to continue.
 * That shape described the machinery, not the job — and it left the user
 * reading step numbers to work out something as simple as "did I send this
 * one". So the machinery moved behind the scenes. The pipeline still runs the
 * generation steps; it just no longer has a face.
 *
 * What is left is what a person actually keeps about a job they are applying
 * to: what has happened (left), and what they have to send (right). The one
 * state that means anything to them — saved, applying, applied, interview,
 * offer, rejected, archived — is a dropdown they can set themselves, because
 * they are the ones who know.
 */

type ArtifactKind = "resume" | "cover-letter";

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  saved: "Saved",
  applying: "Applying",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  archived: "Archived",
};

export function ApplicationDetailClient({
  application,
  initialTask,
  initialArtifacts,
  initialFit,
  initialEvents,
  initialRequirements,
  initialIncidents,
  initialJdAnalysis,
  profileSkills,
}: {
  application: Application;
  initialTask: PipelineTask | null;
  initialArtifacts: Artifact[];
  initialFit: FitAnalysis | null;
  initialEvents: ApplicationEvent[];
  initialRequirements: RequirementsSummary;
  initialIncidents: FillIncidentRow[];
  initialJdAnalysis: JdAnalysis | null;
  /** The applicant's own skills, for the zero-cost highlighting. Passed in
   *  rather than fetched: the page already reads the profile server-side. */
  profileSkills: string[];
}) {
  const [taskId, setTaskId] = useState<string | null>(initialTask?.id ?? null);
  const [task, setTask] = useState<PipelineTask | null>(initialTask);
  const [artifacts, setArtifacts] = useState<Artifact[]>(initialArtifacts);
  const [events, setEvents] = useState<ApplicationEvent[]>(initialEvents);
  const [requirements, setRequirements] = useState<RequirementsSummary>(initialRequirements);
  const [jdText, setJdText] = useState(application.jdText ?? "");
  const [jdAnalysis, setJdAnalysis] = useState<JdAnalysis | null>(initialJdAnalysis);
  const [analyzing, setAnalyzing] = useState(false);
  const [savingJd, setSavingJd] = useState(false);
  const [fit, setFit] = useState<FitAnalysis | null>(initialFit);
  const [status, setStatus] = useState<ApplicationStatus>(application.status);
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [resumeId, setResumeId] = useState<string | undefined>(application.resumeId);
  const [attachResume, setAttachResume] = useState<"tailored" | "original">(
    application.attachResume ?? "tailored",
  );

  const [generating, setGenerating] = useState<ArtifactKind | null>(null);
  const [tweaking, setTweaking] = useState<ArtifactKind | null>(null);
  const [tweakDiff, setTweakDiff] = useState<{ kind: ArtifactKind; diff: LineDiff } | null>(null);
  const [approved, setApproved] = useState<ArtifactKind | null>(null);
  const [checking, setChecking] = useState(false);
  const [fitBusy, setFitBusy] = useState(false);
  const [fitLlmError, setFitLlmError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ticketCreated, setTicketCreated] = useState(false);
  const [showConnectBanner, setShowConnectBanner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const resumeArtifact = artifacts.find((a) => a.kind === "resume") ?? null;
  const coverLetterArtifact = artifacts.find((a) => a.kind === "cover-letter") ?? null;

  useEffect(() => {
    let active = true;
    api.resumes
      .list()
      .then((list) => active && setResumes(list))
      .catch(() => {
        // Non-critical — the picker just stays hidden.
      });
    return () => {
      active = false;
    };
  }, []);

  /** Re-read everything this page shows. Cheap: it is a local database. */
  const refresh = useCallback(async () => {
    const [nextEvents, nextRequirements] = await Promise.all([
      api.applications.events(application.id).catch(() => null),
      api.applications.requirements(application.id).catch(() => null),
    ]);
    if (nextEvents) setEvents(nextEvents);
    if (nextRequirements) setRequirements(nextRequirements);
    // A posting check can backfill the description, so re-read it here rather
    // than making the user reload to see what the check found.
    const fresh = await api.applications.get(application.id).catch(() => null);
    if (fresh) setJdText(fresh.jdText ?? "");
    if (taskId) {
      try {
        const data = await api.pipelineTasks.get(taskId);
        setTask(data.task);
        setArtifacts(data.artifacts);
      } catch {
        // Keep what we have; the page stays readable.
      }
    }
  }, [application.id, taskId]);

  // The fill happens in another tab, in the extension. Anything it records
  // arrives here as an agent event, which is what keeps the report live
  // without a manual reload. Bursts collapse into one refetch.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeToAgentEvents(application.id, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 300);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [application.id, refresh]);

  async function handleStatusChange(next: string) {
    const previous = status;
    setStatus(next as ApplicationStatus); // optimistic
    try {
      await api.applications.update(application.id, { status: next as ApplicationStatus });
      await refresh();
    } catch {
      setStatus(previous);
      setError("Couldn't update the status.");
    }
  }

  async function handleResumeChange(nextId: string) {
    const previous = resumeId;
    setResumeId(nextId);
    try {
      await api.applications.update(application.id, { resumeId: nextId });
    } catch {
      setResumeId(previous);
      setError("Couldn't update the résumé for this application.");
    }
  }

  async function handleAttachResumeChange(next: "tailored" | "original") {
    const previous = attachResume;
    setAttachResume(next);
    try {
      await api.applications.update(application.id, { attachResume: next });
    } catch {
      setAttachResume(previous);
      setError("Couldn't update the attach choice.");
    }
  }

  async function handleSaveJdText(text: string) {
    const trimmed = text.trim();
    if (trimmed === "" || savingJd) return;
    setSavingJd(true);
    setError(null);
    const previous = jdText;
    setJdText(trimmed); // optimistic
    try {
      await api.applications.update(application.id, { jdText: trimmed });
      await refresh();
    } catch {
      setJdText(previous);
      setError("Couldn't save the job description.");
    } finally {
      setSavingJd(false);
    }
  }

  async function handleAnalyzeJd() {
    if (analyzing) return;
    setAnalyzing(true);
    setError(null);
    setShowConnectBanner(false);
    try {
      setJdAnalysis(await api.applications.analyzeJd(application.id));
      await refresh();
    } catch (err) {
      if (isLlmNotConfigured(err)) setShowConnectBanner(true);
      else setError(err instanceof Error ? err.message : "Couldn't read the posting.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleCheck() {
    if (checking) return;
    setChecking(true);
    setError(null);
    try {
      await api.applications.recon(application.id);
      await refresh();
    } catch {
      setError("Couldn't check the posting.");
    } finally {
      setChecking(false);
    }
  }

  /** The task id to generate against, created on demand. The user never sees
   *  this concept; it exists because generation runs a pipeline step. */
  async function ensureTask(): Promise<string> {
    if (taskId) return taskId;
    const created = await api.applications.ensureTask(application.id);
    setTaskId(created.taskId);
    setTask(created.task);
    setArtifacts(created.artifacts);
    return created.taskId;
  }

  async function handleGenerate(kind: ArtifactKind) {
    if (busyRef.current) return;
    busyRef.current = true;
    setGenerating(kind);
    setError(null);
    setShowConnectBanner(false);
    setApproved(null);
    try {
      const id = await ensureTask();
      await (kind === "resume" ? api.pipelineTasks.tailor(id) : api.pipelineTasks.coverLetter(id));
      await refresh();
    } catch (err) {
      if (isLlmNotConfigured(err)) setShowConnectBanner(true);
      else setError("Couldn't generate that. Please try again.");
    } finally {
      busyRef.current = false;
      setGenerating(null);
    }
  }

  async function handleApprove(kind: ArtifactKind) {
    if (!taskId) return;
    setError(null);
    try {
      await api.pipelineTasks.approveArtifact(taskId, kind);
      setApproved(kind);
      setTweakDiff(null);
      await refresh();
    } catch {
      setError("Couldn't record that. Please try again.");
    }
  }

  /** Open (or re-open) a fill ticket, then hand the ATS page to the extension.
   *  Unchanged from the workspace this replaced — the handoff is the one part
   *  of the old machinery the user still touches directly. */
  async function handleOpenAndFill() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    // With the extension present, IT opens the tab — bound to the handoff id,
    // so the panel claims exactly this task with no URL guessing. Without it,
    // open synchronously before the await so popup-blocker heuristics still
    // treat the open as user-initiated.
    const knownApplyLink = application.jobInfo.applyLink;
    const viaExtension = extensionPresent();
    if (!viaExtension && knownApplyLink) window.open(knownApplyLink, "_blank");
    try {
      const id = await ensureTask();
      const handoff = await api.pipelineTasks.fillHandoff(id);
      setTicketCreated(true);
      const link = knownApplyLink ?? handoff.applyLink;
      if (viaExtension && link) {
        const opened = await openFillTabViaExtension(handoff.id, link);
        // Stale bridge (extension updated/disabled since page load) — degrade
        // to a plain open; the panel's heuristic match still has a chance.
        if (!opened) window.open(link, "_blank");
      } else if (!viaExtension && !knownApplyLink && handoff.applyLink) {
        window.open(handoff.applyLink, "_blank");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      await refresh();
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function handleFillResolve(action: "fixed" | "applied-manually") {
    if (!taskId) return;
    setBusy(true);
    try {
      await api.pipelineTasks.fillResolve(taskId, action);
      await refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFitRecompute() {
    if (fitBusy) return;
    setFitBusy(true);
    setError(null);
    setFitLlmError(false);
    try {
      setFit(await api.fit.recompute(application.id));
    } catch (err) {
      if (isLlmNotConfigured(err)) setFitLlmError(true);
      else setError("Something went wrong. Please try again.");
    } finally {
      setFitBusy(false);
    }
  }

  const { jobInfo } = application;

  return (
    <main className="mx-auto w-full max-w-[1120px] px-6 py-6">
      <header className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-body text-muted-foreground">
              {jobInfo.companyName}
              {jobInfo.jobLocation ? ` · ${jobInfo.jobLocation}` : ""}
            </p>
            <h1 className="mt-0.5 text-heading font-semibold text-foreground">
              {jobInfo.jobTitle}
            </h1>
            {jobInfo.applyLink && (
              <a
                href={jobInfo.applyLink}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground"
              >
                <ExternalLink aria-hidden className="size-3.5" />
                Original posting
              </a>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <LabeledSelect
              label="Status"
              value={status}
              onChange={handleStatusChange}
              options={APPLICATION_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            />
            <button
              type="button"
              onClick={handleCheck}
              disabled={checking}
              className="inline-flex items-center gap-1.5 self-end rounded-full border border-border px-3.5 py-2 text-caption font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              <Search aria-hidden className="size-3.5" />
              {checking ? "Checking…" : "Check job"}
            </button>
            <Link
              href={`/agent?application=${application.id}`}
              className="inline-flex items-center gap-1.5 self-end rounded-full bg-primary px-3.5 py-2 text-caption font-semibold text-primary-foreground press hover:bg-primary/85"
            >
              <MessageSquare aria-hidden className="size-3.5" />
              Ask agent
            </Link>
          </div>
        </div>

        {requirements.lastChecked && (
          <p className="mt-3 text-caption text-muted-foreground">
            {requirements.lastChecked.detail}
          </p>
        )}
      </header>

      {showConnectBanner && <ConnectProviderNote message="Connect your AI provider to generate" />}
      {error && <p className="mt-3 text-caption text-destructive">{error}</p>}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
        {/* ── The record: what has happened to this application ───────────── */}
        <div className="space-y-4">
          <JdCard
            jobInfo={jobInfo}
            jdText={jdText}
            analysis={jdAnalysis}
            profileSkills={profileSkills}
            onAnalyze={() => void handleAnalyzeJd()}
            onSaveJdText={(text) => void handleSaveJdText(text)}
            onCheckPosting={() => void handleCheck()}
            analyzing={analyzing}
            saving={savingJd}
          />

          <FormCard
            task={task}
            incidents={initialIncidents}
            busy={busy}
            ticketCreated={ticketCreated}
            onOpenAndFill={() => void handleOpenAndFill()}
            onFixed={() => void handleFillResolve("fixed")}
            onApplied={() => void handleFillResolve("applied-manually")}
          />

          <TimelineCard applicationId={application.id} events={events} />
        </div>

        {/* ── The materials: what gets sent ───────────────────────────────── */}
        <div className="space-y-4">
          <RequirementsCard
            requirements={requirements}
            onCheck={handleCheck}
            checking={checking}
            hasCoverLetter={coverLetterArtifact !== null}
            onWriteCoverLetter={() => void handleGenerate("cover-letter")}
          />

          {fit && (
            <FitCard
              fit={fit}
              onRecompute={handleFitRecompute}
              busy={fitBusy}
              llmError={fitLlmError}
            />
          )}

          <MaterialCard
            kind="resume"
            title="Tailored résumé"
            artifact={resumeArtifact}
            generating={generating === "resume"}
            approved={approved === "resume"}
            onGenerate={() => void handleGenerate("resume")}
            onTweak={() => setTweaking("resume")}
            onApprove={() => void handleApprove("resume")}
          />
          {tweaking === "resume" && taskId && (
            <TweakInput
              taskId={taskId}
              kind="resume"
              onResult={(result) => {
                setTweakDiff({ kind: "resume", diff: result.diff });
                setTweaking(null);
                setShowConnectBanner(false);
                void refresh();
              }}
              onCancel={() => setTweaking(null)}
              onError={(err) => isLlmNotConfigured(err) && setShowConnectBanner(true)}
            />
          )}
          {tweakDiff?.kind === "resume" && <VersionDiff diff={tweakDiff.diff} />}

          <MaterialCard
            kind="cover-letter"
            title="Cover letter"
            artifact={coverLetterArtifact}
            generating={generating === "cover-letter"}
            approved={approved === "cover-letter"}
            onGenerate={() => void handleGenerate("cover-letter")}
            onTweak={() => setTweaking("cover-letter")}
            onApprove={() => void handleApprove("cover-letter")}
          />
          {tweaking === "cover-letter" && taskId && (
            <TweakInput
              taskId={taskId}
              kind="cover-letter"
              onResult={(result) => {
                setTweakDiff({ kind: "cover-letter", diff: result.diff });
                setTweaking(null);
                setShowConnectBanner(false);
                void refresh();
              }}
              onCancel={() => setTweaking(null)}
              onError={(err) => isLlmNotConfigured(err) && setShowConnectBanner(true)}
            />
          )}
          {tweakDiff?.kind === "cover-letter" && <VersionDiff diff={tweakDiff.diff} />}

          {resumes.length > 0 && (
            <section className="rounded-2xl border border-border bg-card p-4">
              <LabeledSelect
                label="Résumé for this application"
                value={effectiveResumeId(resumeId, resumes) ?? ""}
                onChange={handleResumeChange}
                options={resumes.map((r) => ({
                  value: r.id,
                  label: r.note ? `${r.name} — ${r.note}` : r.name,
                }))}
              />
              {(() => {
                const effective = resumes.find(
                  (r) => r.id === effectiveResumeId(resumeId, resumes),
                );
                if (!effective?.hasFile) return null;
                return (
                  <div className="mt-3">
                    <span className="text-caption font-medium text-muted-foreground">Attach</span>
                    <div className="mt-1 inline-flex overflow-hidden rounded-full ring-1 ring-inset ring-border">
                      {(
                        [
                          { value: "tailored", label: "Tailored PDF" },
                          { value: "original", label: "Original file" },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={attachResume === option.value}
                          onClick={() => handleAttachResumeChange(option.value)}
                          className={cn(
                            "px-3.5 py-1.5 text-caption font-semibold transition-colors",
                            attachResume === option.value
                              ? "bg-primary text-primary-foreground"
                              : "bg-card text-foreground hover:bg-muted",
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * One document: absent and offered, or present and reviewable.
 *
 * "Accept" is not a gate the app is waiting on — nothing blocks without it.
 * It exists because accepting after asking for three changes is the signal
 * style memory learns from, and that signal is only available if the user has
 * a way to say "yes, that one".
 */
function MaterialCard({
  kind,
  title,
  artifact,
  generating,
  approved,
  onGenerate,
  onTweak,
  onApprove,
}: {
  kind: ArtifactKind;
  title: string;
  artifact: Artifact | null;
  generating: boolean;
  approved: boolean;
  onGenerate: () => void;
  onTweak: () => void;
  onApprove: () => void;
}) {
  if (!artifact) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-body font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-caption text-muted-foreground">
          {kind === "resume"
            ? "Reorders and re-emphasises your own résumé for this posting."
            : "Grounded in this posting and your résumé."}
        </p>
        <SpendChip
          onClick={onGenerate}
          label="Generate"
          busyLabel="Generating…"
          busy={generating}
          variant="primary"
          className="mt-3"
        />
      </section>
    );
  }

  return (
    <div className="space-y-2">
      <ArtifactViewer artifact={artifact} />
      <div className="flex flex-wrap items-center gap-2">
        <SpendChip onClick={onTweak} label="Change something" />
        <button
          type="button"
          onClick={onApprove}
          className="rounded-full border border-border px-3.5 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
        >
          Accept
        </button>
        <SpendChip
          onClick={onGenerate}
          label="Start over"
          busyLabel="Generating…"
          busy={generating}
          variant="quiet"
        />
        {approved && <span className="text-caption text-success">Accepted</span>}
      </div>
    </div>
  );
}

/** The résumé that actually applies: the explicit selection if one was made
 *  AND still exists, otherwise the account's primary. A selection pointing at
 *  a since-deleted résumé self-heals rather than leaving an empty picker. */
export function effectiveResumeId(
  resumeId: string | undefined,
  resumes: ResumeSummary[],
): string | undefined {
  const selected = resumeId && resumes.some((r) => r.id === resumeId) ? resumeId : undefined;
  return selected ?? resumes.find((r) => r.isPrimary)?.id;
}
