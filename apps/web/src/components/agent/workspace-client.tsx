"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PIPELINE_STEPS,
  type Application,
  type AgentTask,
  type ApplicationEvent,
  type Artifact,
  type JdAnalysis,
  type FitAnalysis,
  type ResumeSummary,
} from "@offeros/core";
import type { LineDiff } from "@/lib/diff";
import { api, isLlmNotConfigured } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { LabeledSelect } from "@/components/profile/fields";
import { JobCard } from "./job-card";
import { StepTimeline } from "./step-timeline";
import { AgentStatusBar } from "./agent-status-bar";
import { GateCard, type GateKind } from "./gate-card";
import { TweakInput } from "./tweak-input";
import { ArtifactViewer } from "./artifact-viewer";
import { VersionDiff } from "./version-diff";
import { GapsCard } from "./gaps-card";
import { FitCard } from "./fit-card";
import { FillReportCard } from "./fill-report-card";
import { SubmitGateCard } from "./submit-gate-card";
import { ConnectProviderNote } from "./connect-provider-note";
import { TimelineCard } from "./timeline-card";
import { EmptyState } from "@/components/empty-state";

const POLL_MS = 1500;

type ArtifactKind = "resume" | "cover-letter";

const GATE_ARTIFACT_KIND: Record<"confirm-resume" | "confirm-cover-letter", ArtifactKind> = {
  "confirm-resume": "resume",
  "confirm-cover-letter": "cover-letter",
};

/** Which gate (if any) the task is currently stopped at, awaiting user input. */
export function deriveGate(task: AgentTask): GateKind | "fill-form" | "submit" | null {
  if (task.status !== "awaiting_user") return null;
  const step = PIPELINE_STEPS[task.step];
  if (!step) return null;
  switch (step.key) {
    case "confirm-resume":
      return "confirm-resume";
    case "confirm-cover-letter":
      return "confirm-cover-letter";
    case "generate-cover-letter":
      // Mirrors the server gate: optional or as-yet-unknown → present the choice.
      return task.coverLetterRequirement === "optional" || task.coverLetterRequirement === "unknown"
        ? "choice"
        : null;
    case "fill-form":
      // Action Required (status 2) is rendered by StepTimeline's embedded
      // ActionRequiredCard instead of the "Open & fill" placeholder.
      return task.applicationInfo?.status === 2 ? null : "fill-form";
    case "submit":
      // Defensive: never present ready-to-submit while applicationInfo still
      // records an action-required state (status 2), even on a bad transition.
      return task.applicationInfo?.status !== 2 ? "submit" : null;
    default:
      return null;
  }
}

/** The résumé that actually applies to an application: the explicit selection
 *  if one was made AND still exists, otherwise the account's primary résumé.
 *  Single source of the default-to-primary rule so the picker and any downstream
 *  consumer agree. A selection pointing at a since-deleted résumé self-heals to
 *  primary rather than leaving a broken/empty picker. */
export function effectiveResumeId(
  resumeId: string | undefined,
  resumes: ResumeSummary[],
): string | undefined {
  const selected = resumeId && resumes.some((r) => r.id === resumeId) ? resumeId : undefined;
  return selected ?? resumes.find((r) => r.isPrimary)?.id;
}

/** True while the pipeline is mid-run, or stalled at the fill-form gate where
 * the extension writes fieldReports/applicationInfo out-of-band and the live
 * report table needs to reflect that without a manual reload. */
export function shouldPoll(task: AgentTask | null): boolean {
  if (!task) return false;
  if (task.status === "running") return true;
  return task.status === "awaiting_user" && PIPELINE_STEPS[task.step]?.key === "fill-form";
}

export function WorkspaceClient({
  application,
  initialTask,
  initialJdAnalysis,
  initialArtifacts,
  initialFit,
}: {
  application: Application;
  initialTask: AgentTask | null;
  initialJdAnalysis: JdAnalysis | null;
  initialArtifacts: Artifact[];
  initialFit: FitAnalysis | null;
}) {
  const [taskId, setTaskId] = useState<string | null>(initialTask?.id ?? null);
  const [task, setTask] = useState<AgentTask | null>(initialTask);
  const [jdAnalysis, setJdAnalysis] = useState<JdAnalysis | null>(initialJdAnalysis);
  const [artifacts, setArtifacts] = useState<Artifact[]>(initialArtifacts);
  const [fit, setFit] = useState<FitAnalysis | null>(initialFit);
  const [fitBusy, setFitBusy] = useState(false);
  const [tweaking, setTweaking] = useState<ArtifactKind | null>(null);
  const [tweakDiff, setTweakDiff] = useState<{ kind: ArtifactKind; diff: LineDiff } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showConnectBanner, setShowConnectBanner] = useState(false);
  const [fitLlmError, setFitLlmError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ticketCreated, setTicketCreated] = useState(false);
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [resumeId, setResumeId] = useState<string | undefined>(application.resumeId);
  const [attachResume, setAttachResume] = useState<"tailored" | "original">(
    application.attachResume ?? "tailored",
  );
  const [events, setEvents] = useState<ApplicationEvent[]>([]);
  const busyRef = useRef(false);

  // The résumé picker's options; failing to load them simply hides the picker.
  useEffect(() => {
    let active = true;
    api.resumes
      .list()
      .then((list) => {
        if (active) setResumes(list);
      })
      .catch(() => {
        // Non-critical — the picker just stays hidden.
      });
    return () => {
      active = false;
    };
  }, []);

  // The timeline's history. Fetched on mount and re-fetched on every
  // `syncFull` (see below) so it rides the same cadence as the step
  // timeline/artifacts — including the poll while the pipeline is mid-run or
  // stalled at the fill-form gate. A failed fetch never breaks the sync; the
  // card just keeps its last known state.
  const fetchEvents = useCallback(async () => {
    try {
      setEvents(await api.applications.events(application.id));
    } catch {
      // Non-critical — the card just keeps its last known state.
    }
  }, [application.id]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  async function handleResumeChange(nextId: string) {
    const prev = resumeId;
    setResumeId(nextId); // optimistic
    try {
      await api.applications.update(application.id, { resumeId: nextId });
    } catch {
      setResumeId(prev);
      setError("Couldn't update the résumé for this application.");
    }
  }

  async function handleAttachResumeChange(next: "tailored" | "original") {
    const prev = attachResume;
    setAttachResume(next); // optimistic
    try {
      await api.applications.update(application.id, { attachResume: next });
    } catch {
      setAttachResume(prev);
      setError("Couldn't update the attach choice for this application.");
    }
  }

  const syncFull = useCallback(
    async (id: string) => {
      const data = await api.agentTasks.get(id);
      setTask(data.task);
      setJdAnalysis(data.jdAnalysis);
      setArtifacts(data.artifacts);
      await fetchEvents();
    },
    [fetchEvents],
  );

  // Poll while the pipeline is mid-run: `start`/`advance`/`choice` each block
  // server-side until the next gate, but the DB is written to incrementally
  // as steps complete, so a concurrent GET can surface interim progress. Also
  // poll while stalled at the fill-form gate — the extension writes
  // fieldReports/applicationInfo out-of-band while the tab is open, so the
  // report table needs to stay live without a manual reload. Local API, so
  // continuous polling at the gate is acceptable.
  const poll = shouldPoll(task);
  useEffect(() => {
    if (!taskId || !poll) return;
    const interval = setInterval(() => {
      void syncFull(taskId);
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [taskId, poll, syncFull]);

  async function run(id: string, action: (id: string) => Promise<unknown>, optimistic = true) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setShowConnectBanner(false);
    if (optimistic) setTask((t) => (t ? { ...t, status: "running" } : t));
    try {
      await action(id);
    } catch (err) {
      if (isLlmNotConfigured(err)) {
        setShowConnectBanner(true);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      try {
        await syncFull(id);
      } catch {
        // best-effort refresh; the action's own error (if any) already surfaced
      }
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function ensureTaskId(): Promise<string> {
    if (taskId) return taskId;
    const created = await api.agentTasks.create({ applicationId: application.id });
    setTaskId(created.id);
    setTask(created);
    return created.id;
  }

  async function handleStart() {
    const id = await ensureTaskId();
    await run(id, (tid) => api.agentTasks.start(tid));
  }

  async function handlePause() {
    if (!taskId) return;
    await run(taskId, (tid) => api.agentTasks.pause(tid), false);
  }

  async function handleApprove() {
    if (!taskId) return;
    setTweakDiff(null);
    await run(taskId, (tid) => api.agentTasks.advance(tid));
  }

  async function handleChoice(choice: "skip" | "generate") {
    if (!taskId) return;
    await run(taskId, (tid) => api.agentTasks.choice(tid, choice));
  }

  /** Open (or re-open) a fill ticket, then hand the ATS page to the extension. */
  async function handleOpenAndFill() {
    if (!taskId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    // Open synchronously, before the await, so browsers' popup-blocker
    // heuristics still treat it as user-initiated. The link is already known
    // from the application record; fall back to the handoff's link only if
    // it wasn't (current behavior, minus the popup-safety).
    const knownApplyLink = application.jobInfo.applyLink;
    if (knownApplyLink) window.open(knownApplyLink, "_blank");
    try {
      const handoff = await api.agentTasks.fillHandoff(taskId);
      setTicketCreated(true);
      if (!knownApplyLink && handoff.applyLink) window.open(handoff.applyLink, "_blank");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      try {
        await syncFull(taskId);
      } catch {
        // best-effort refresh; the action's own error (if any) already surfaced
      }
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function handleFillResolve(action: "fixed" | "applied-manually") {
    if (!taskId) return;
    await run(taskId, (tid) => api.agentTasks.fillResolve(tid, action));
  }

  async function handleFitRecompute() {
    if (fitBusy) return;
    setFitBusy(true);
    setError(null);
    setFitLlmError(false);
    try {
      setFit(await api.fit.recompute(application.id));
    } catch (err) {
      if (isLlmNotConfigured(err)) {
        setFitLlmError(true);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setFitBusy(false);
    }
  }

  function openTweak(gate: GateKind) {
    if (gate === "choice") return;
    setTweaking(GATE_ARTIFACT_KIND[gate]);
  }

  function handleTweakResult(kind: ArtifactKind, result: { diff: LineDiff }) {
    setTweakDiff({ kind, diff: result.diff });
    setTweaking(null);
    // A successful tweak proves the provider is configured — drop any banner
    // raised by an earlier failed attempt so it doesn't linger after recovery.
    setShowConnectBanner(false);
    if (taskId) void syncFull(taskId);
  }

  const gate = task ? deriveGate(task) : null;

  // Drop the "ticket created" feedback once the task leaves the fill-form
  // gate (resolved, re-entered on a later task, etc.) so a later Re-fill
  // visit doesn't show stale feedback from a previous ticket.
  useEffect(() => {
    if (gate !== "fill-form") setTicketCreated(false);
  }, [gate, taskId]);

  const resumeArtifact = artifacts.find((a) => a.kind === "resume") ?? null;
  const coverLetterArtifact = artifacts.find((a) => a.kind === "cover-letter") ?? null;

  function currentVersion(artifact: Artifact) {
    return artifact.versions.find((v) => v.id === artifact.currentVersionId);
  }

  const gateRationale: string | undefined =
    gate === "confirm-resume"
      ? resumeArtifact
        ? currentVersion(resumeArtifact)?.rationale
        : undefined
      : gate === "confirm-cover-letter"
        ? coverLetterArtifact
          ? currentVersion(coverLetterArtifact)?.rationale
          : undefined
        : gate === "choice"
          ? (jdAnalysis?.summary ?? "A cover letter is optional for this role.")
          : undefined;

  const isGateAwait = task?.status === "awaiting_user" && task.applicationInfo?.status !== 2;
  const statusBarState: "standby-empty" | "standby-queued" | "running" | "action-required" = !task
    ? "standby-empty"
    : task.applicationInfo?.status === 2 && task.status !== "done"
      ? "action-required"
      : task.status === "running"
        ? "running"
        : "standby-queued";
  const statusBarAction =
    isGateAwait || busy ? undefined : statusBarState === "running" ? handlePause : handleStart;

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 flex-col px-6 py-6">
      <AgentStatusBar state={statusBarState} jobCount={1} onAction={statusBarAction} />

      {showConnectBanner && <ConnectProviderNote message="Connect your AI provider to start" />}

      <div className="mt-4 grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[380px_1fr]">
        <div className="min-h-0 space-y-4 overflow-y-auto pb-2 pr-1">
          <JobCard job={application.jobInfo} />

          {resumes.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-4">
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
                return effective && !effective.text?.trim() ? (
                  <p className="mt-2 text-caption text-muted-foreground">
                    No text extracted from this résumé — tailoring will use your profile facts.
                    Re-upload it to enable real-résumé tailoring.
                  </p>
                ) : null;
              })()}
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
            </div>
          )}

          {task ? (
            <StepTimeline
              task={task}
              tailoredResume={resumeArtifact !== null}
              tailoredCoverLetter={coverLetterArtifact !== null}
              onReFill={handleOpenAndFill}
              onFixed={() => handleFillResolve("fixed")}
              onApplied={() => handleFillResolve("applied-manually")}
            />
          ) : (
            <EmptyState
              title="Not started"
              body="The agent hasn't started on this application yet."
            />
          )}

          {task && gate && gate !== "fill-form" && gate !== "submit" && (
            <GateCard
              task={task}
              kind={gate}
              rationale={gateRationale}
              onApprove={handleApprove}
              onTweak={() => openTweak(gate)}
              onSkip={() => handleChoice("skip")}
              onGenerate={() => handleChoice("generate")}
            />
          )}

          {task && gate === "fill-form" && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="text-body font-semibold text-foreground">Ready to fill out the form</p>
              <p className="mt-1 text-body text-muted-foreground">
                The résumé and cover letter are set — open the application and the Side Panel will
                fill it in.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleOpenAndFill}
                  className="inline-flex items-center rounded-full bg-primary px-3.5 py-1.5 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
                >
                  Open & fill
                </button>
              </div>
              {ticketCreated && (
                <p className="mt-2 text-caption text-muted-foreground">
                  Ticket created — the Side Panel will pick it up on the ATS page.
                </p>
              )}
            </div>
          )}

          {task && gate === "submit" && <SubmitGateCard onMarkSubmitted={handleApprove} />}

          {task && task.fieldReports.length > 0 && <FillReportCard reports={task.fieldReports} />}

          {tweaking && taskId && (
            <TweakInput
              taskId={taskId}
              kind={tweaking}
              onResult={(result) => handleTweakResult(tweaking, result)}
              onCancel={() => {
                setTweaking(null);
                setShowConnectBanner(false);
              }}
              onError={(err) => {
                if (isLlmNotConfigured(err)) setShowConnectBanner(true);
              }}
            />
          )}

          {error && <p className="text-caption text-destructive">{error}</p>}
        </div>

        <div className="min-h-0 space-y-4 overflow-y-auto pb-2 pl-1">
          {fit && (
            <FitCard
              fit={fit}
              onRecompute={handleFitRecompute}
              busy={fitBusy}
              llmError={fitLlmError}
            />
          )}

          {jdAnalysis && <GapsCard analysis={jdAnalysis} />}

          {resumeArtifact && <ArtifactViewer artifact={resumeArtifact} />}
          {tweakDiff?.kind === "resume" && <VersionDiff diff={tweakDiff.diff} />}

          {coverLetterArtifact && <ArtifactViewer artifact={coverLetterArtifact} />}
          {tweakDiff?.kind === "cover-letter" && <VersionDiff diff={tweakDiff.diff} />}

          {!fit && !jdAnalysis && !resumeArtifact && !coverLetterArtifact && (
            <EmptyState
              title="Nothing to show yet"
              body="Artifacts will appear here once the agent starts working."
            />
          )}

          <TimelineCard applicationId={application.id} events={events} />
        </div>
      </div>
    </main>
  );
}
