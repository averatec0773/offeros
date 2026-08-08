import {
  PIPELINE_STEPS,
  deriveApplicationInfo,
  mergeFieldReports,
  answerSchema,
  type AgentTask,
  type Artifact,
  type FieldReport,
  type FillHandoff,
  type JobInfo,
  type Profile,
} from "@offeros/core";
import type { AnswerEntry, FillPersonalInfo, FillProfile } from "@offeros/autofill";
import type { Db } from "../db/client";
import { answers } from "../db/schema";
import { createAgentTask, getAgentTask, updateAgentTask } from "../repositories/agent-task-repo";
import { getAgentTaskByApplicationId } from "../repositories/agent-task-by-application";
import {
  createApplication,
  getApplication,
  listApplicationsByJobUrl,
  updateApplication,
} from "../repositories/application-repo";
import { getArtifact } from "../repositories/artifact-repo";
import { getJdAnalysis } from "../repositories/jd-analysis-repo";
import { getProfile } from "../repositories/profile-repo";
import { appendEvent, listEvents } from "../repositories/application-event-repo";
import { buildProfileFacts, resolveEffectiveResume } from "../pipeline/steps/grounding";
import { listResumes } from "./resume-service";
import {
  createFillHandoff,
  getFillHandoff,
  listOpenFillHandoffs,
  updateFillHandoff,
} from "../repositories/fill-handoff-repo";

/**
 * A caller-facing precondition failure (bad task state, wrong ticket status).
 * Distinct from an unexpected `Error` so route handlers (Task 5) can map it to a
 * 400 while genuine bugs stay 500.
 */
export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

const stepIndex = (key: (typeof PIPELINE_STEPS)[number]["key"]): number =>
  PIPELINE_STEPS.findIndex((s) => s.key === key);

/** Mark every open (pending/claimed) handoff for this task `completed`. Called on
 *  any terminal transition of the fill run (report complete, or a resolveFill) so
 *  a claimed ticket is never left dangling open forever. */
function closeOpenHandoffsForTask(db: Db, taskId: string): void {
  for (const handoff of listOpenFillHandoffs(db)) {
    if (handoff.taskId === taskId) updateFillHandoff(db, handoff.id, { status: "completed" });
  }
}

function requireTask(db: Db, taskId: string): AgentTask {
  const task = getAgentTask(db, taskId);
  if (!task) throw new ServiceError(`agent task ${taskId} not found`);
  return task;
}

function persist(db: Db, taskId: string, patch: Parameters<typeof updateAgentTask>[2]): AgentTask {
  const updated = updateAgentTask(db, taskId, patch);
  if (!updated) throw new ServiceError(`agent task ${taskId} not found`);
  return updated;
}

/**
 * Open a fill ticket for a task the runner has parked at the `fill-form` gate.
 * Guard: the task must be `awaiting_user` sitting on the fill-form step — any
 * other state means it is not the extension's turn to fill.
 */
export function createHandoffForTask(db: Db, taskId: string): FillHandoff {
  const task = requireTask(db, taskId);
  if (task.status !== "awaiting_user" || PIPELINE_STEPS[task.step]?.key !== "fill-form") {
    throw new ServiceError("task is not awaiting fill");
  }
  const application = getApplication(db, task.applicationId);
  const handoff = createFillHandoff(db, {
    taskId,
    applicationId: task.applicationId,
    applyLink: application?.jobInfo.applyLink,
  });
  // Timeline + live push: an open panel on the right page learns a ticket
  // exists without waiting for a rescan.
  appendEvent(db, { applicationId: task.applicationId, kind: "fill-handoff-created" });
  return handoff;
}

/**
 * The extension's one-click "fill this page now" entry — the instant lane.
 * Deterministic profile-based filling never needed the generation pipeline,
 * so this parks a task directly at the fill-form gate and returns a claimed
 * bundle in one call:
 *   - no application tracks this URL → create application (attachResume
 *     "original": no tailored artifact exists yet) + a `fillFirst` task at
 *     the fill gate,
 *   - the URL's application has a task already awaiting fill → reuse it
 *     (a fresh ticket is opened and claimed — same as a workspace re-fill),
 *   - its task is anywhere else in the pipeline → ServiceError: filling now
 *     would fight the workspace's state gates; the panel offers "open in
 *     OfferOS" instead.
 * Every path lands on the SAME handoff/report machinery as the workspace
 * lane, so reports, AI answers, and the submit gate all just work.
 */
export function startInstantFill(
  db: Db,
  input: { jobInfo: JobInfo; jdText?: string },
): FillTaskBundle {
  const applyLink = input.jobInfo.applyLink;
  if (!applyLink) throw new ServiceError("instant fill needs the page URL");

  const existing = listApplicationsByJobUrl(db, applyLink)[0];
  let taskId: string;
  let applicationId: string;

  if (existing) {
    applicationId = existing.id;
    const task = getAgentTaskByApplicationId(db, existing.id);
    if (task && task.status === "awaiting_user" && PIPELINE_STEPS[task.step]?.key === "fill-form") {
      taskId = task.id;
    } else if (task) {
      throw new ServiceError("already tracked in OfferOS — open the application workspace");
    } else {
      taskId = createFillFirstTask(db, existing.id);
    }
  } else {
    const application = createApplication(db, {
      jobInfo: input.jobInfo,
      jdText: input.jdText,
      attachResume: "original",
    });
    applicationId = application.id;
    taskId = createFillFirstTask(db, application.id);
  }

  const handoff = createFillHandoff(db, { taskId, applicationId, applyLink });
  appendEvent(db, { applicationId, kind: "instant-fill-started" });
  return claimHandoff(db, handoff.id);
}

/** A task born at the fill gate: `fillFirst` marks the skipped generation
 *  steps so the timeline renders them as skipped, never as done. */
function createFillFirstTask(db: Db, applicationId: string): string {
  return createAgentTask(db, {
    applicationId,
    status: "awaiting_user",
    step: stepIndex("fill-form"),
    fillFirst: true,
  }).id;
}

export type FillTaskBundle = {
  handoffId: string;
  taskId: string;
  applicationId: string;
  job: { title: string; company: string; applyLink?: string };
  fillProfile: FillProfile;
  resumeText: string | null;
  coverLetterText: string | null;
  jdSummary: string | null;
  /** Which stored résumé file the extension should attach to the ATS's file
   *  input: the AI-tailored PDF export, or the user's original uploaded file
   *  (`resumeId` below). Defaults to "tailored" when the application has no
   *  explicit choice. */
  attachResume: "tailored" | "original";
  /** The application's effective résumé id (explicit selection, else the
   *  account's primary) — the same résumé `resumeText` is grounded in.
   *  Present so the panel can fetch the original stored file via
   *  `GET /api/v1/resumes/[id]/file` when `attachResume` is "original".
   *  Undefined when the account has no résumés at all. */
  resumeId?: string;
  /** The task's accumulated per-field reports — a re-claiming panel (extension
   *  reloaded mid-fill) rehydrates its cumulative report from these instead of
   *  restarting the session from zero. */
  fieldReports: FieldReport[];
};

const EMPTY_PERSONAL: FillPersonalInfo = { name: "", email: "", phone: "", address: "", links: {} };

/** The highest-ranked degree string among the profile's education entries —
 *  ranked by keyword so "M.S. in CS" still reads as a masters. */
function pickHighestDegree(degrees: string[]): string | undefined {
  const rank = (d: string): number => {
    const t = d.toLowerCase();
    if (/ph\.?d|doctor/.test(t)) return 4;
    if (/master|m\.?s\.?|m\.?eng|mba/.test(t)) return 3;
    if (/bachelor|b\.?s\.?|b\.?a\.?|b\.?eng/.test(t)) return 2;
    return d.trim() ? 1 : 0;
  };
  const best = degrees.filter((d) => d.trim()).sort((a, b) => rank(b) - rank(a))[0];
  return best || undefined;
}

function toFillPersonal(profile: Profile | null): FillPersonalInfo {
  if (!profile) return EMPTY_PERSONAL;
  const p = profile.personal;
  // profile.experience is ordered most-recent-first (onboarding parse + the
  // profile editor both keep that order) — [0] backs the ubiquitous
  // "most recent company / job title" questions.
  const recent = profile.experience?.[0];
  const highestDegree = pickHighestDegree(profile.education?.map((e) => e.degree) ?? []);
  return {
    name: p.name,
    email: p.email,
    phone: p.phone,
    address: p.address ?? "",
    city: p.city,
    state: p.state,
    country: p.country,
    postalCode: p.postalCode,
    recentCompany: recent?.company || undefined,
    recentTitle: recent?.title || undefined,
    highestDegree,
    links: p.links,
  };
}

/** All saved answers, mapped to the engine's AnswerEntry (structurally identical to core's). */
function listAnswerBank(db: Db): AnswerEntry[] {
  return db
    .select()
    .from(answers)
    .all()
    .map((row) => answerSchema.parse(row.doc) as AnswerEntry);
}

/** Content of an artifact's current version, or null if the artifact is absent. */
function currentVersionContent(artifact: Artifact | null): string | null {
  if (!artifact) return null;
  const version = artifact.versions.find((v) => v.id === artifact.currentVersionId);
  return version?.content ?? null;
}

/**
 * Claim a pending ticket and hand the extension everything it needs to fill:
 * the job header, the flattened fill profile, and the current tailored artifacts.
 * Re-claiming an already-claimed ticket is idempotent — this is a single-user
 * local app, and the panel loses its in-memory bundle whenever it (or the
 * whole extension) reloads mid-fill; the same ticket must be recoverable or
 * the session strands as "no task". Only completed/cancelled tickets refuse.
 */
export function claimHandoff(db: Db, handoffId: string): FillTaskBundle {
  const handoff = getFillHandoff(db, handoffId);
  if (!handoff) throw new ServiceError(`fill handoff ${handoffId} not found`);
  if (handoff.status !== "pending" && handoff.status !== "claimed") {
    throw new ServiceError(`fill handoff ${handoffId} is not open`);
  }

  const task = requireTask(db, handoff.taskId);
  const application = getApplication(db, handoff.applicationId);
  const jdAnalysis = getJdAnalysis(db, handoff.applicationId);
  const profile = getProfile(db);
  const effectiveResume = resolveEffectiveResume(
    { resumeId: application?.resumeId },
    listResumes(db),
  );

  const fillProfile: FillProfile = {
    personal: toFillPersonal(profile),
    skills: profile?.skills ?? [],
    answerBank: listAnswerBank(db),
  };

  const coverLetter = task.skippedCoverLetter
    ? null
    : currentVersionContent(getArtifact(db, handoff.taskId, "cover-letter"));

  const bundle: FillTaskBundle = {
    handoffId: handoff.id,
    taskId: handoff.taskId,
    applicationId: handoff.applicationId,
    job: {
      title: application?.jobInfo.jobTitle ?? "",
      company: application?.jobInfo.companyName ?? "",
      applyLink: application?.jobInfo.applyLink,
    },
    fillProfile,
    resumeText: currentVersionContent(getArtifact(db, handoff.taskId, "resume")),
    coverLetterText: coverLetter,
    jdSummary: jdAnalysis?.summary ?? null,
    // A stale "original" preference on a résumé that no longer has a stored file (or
    // never had one) would otherwise send the extension straight at a guaranteed 404 —
    // degrade to "tailored" instead of trusting the preference blindly.
    attachResume:
      application?.attachResume === "original" && effectiveResume?.hasFile
        ? "original"
        : "tailored",
    resumeId: effectiveResume?.id,
    fieldReports: task.fieldReports ?? [],
  };

  updateFillHandoff(db, handoff.id, { status: "claimed" });
  return bundle;
}

/**
 * Fold a batch of per-field reports into the task. Always merges + persists the
 * reports and the derived Action-Required contract (live progress). When
 * `complete`, the fill run is finished: the open ticket is marked completed and
 * the task moves off fill-form — to the submit gate if everything landed
 * (status 1), or held at fill-form as Action Required if a required field is
 * still missing (status 2). Never auto-submits.
 */
export function applyFillReport(
  db: Db,
  taskId: string,
  reports: FieldReport[],
  complete: boolean,
): AgentTask {
  const task = requireTask(db, taskId);
  if (task.status !== "awaiting_user" || PIPELINE_STEPS[task.step]?.key !== "fill-form") {
    throw new ServiceError("task is not awaiting fill");
  }
  const merged = mergeFieldReports(task.fieldReports ?? [], reports);
  const applicationInfo = deriveApplicationInfo(merged);

  let result: AgentTask;
  if (!complete) {
    result = persist(db, taskId, { fieldReports: merged, applicationInfo });
  } else {
    closeOpenHandoffsForTask(db, taskId);

    if (applicationInfo?.status === 1) {
      result = persist(db, taskId, {
        fieldReports: merged,
        applicationInfo,
        step: stepIndex("submit"),
        status: "awaiting_user",
      });
    } else {
      // status 2 (or no reports): hold at fill-form as Action Required.
      result = persist(db, taskId, {
        fieldReports: merged,
        applicationInfo,
        status: "awaiting_user",
      });
    }
  }

  // Mirror fill-report-card.tsx's own bucketing: it renders everything
  // outcome !== "filled" (needs-user, failed, or skipped) under "Needs
  // attention" — the event payload must count the same way the card reads,
  // not just the narrower "needs-user" outcome.
  const filled = merged.filter((r) => r.outcome === "filled").length;
  const needsAttention = merged.filter((r) => r.outcome !== "filled").length;
  appendEvent(db, {
    applicationId: task.applicationId,
    kind: "fill-reported",
    payload: { filled, needsAttention },
  });

  return result;
}

/**
 * Resolve an Action-Required task. "fixed": the user handled the outstanding
 * fields themselves, so mark everything filled (status 1) and advance to the
 * submit gate. "applied-manually": the user applied outside OfferOS, so finish
 * the task and mark the application applied.
 *
 * Both are terminal resolutions of the fill run: the extension is done with this
 * task either way, so each closes any still-open (pending/claimed) handoff — the
 * same way `applyFillReport` does on a complete report — so a claimed ticket is
 * never left dangling open.
 */
export function resolveFill(
  db: Db,
  taskId: string,
  action: "fixed" | "applied-manually",
): AgentTask {
  const task = requireTask(db, taskId);

  if (action === "applied-manually") {
    // Valid from either awaiting_user gate the user can be sitting on: the
    // fill-form (Action Required) gate or the submit gate.
    const stepKey = PIPELINE_STEPS[task.step]?.key;
    if (task.status !== "awaiting_user" || (stepKey !== "fill-form" && stepKey !== "submit")) {
      throw new ServiceError("task is not awaiting a fill resolution");
    }
    closeOpenHandoffsForTask(db, taskId);
    const prevApplicationStatus = getApplication(db, task.applicationId)?.status;
    updateApplication(db, task.applicationId, { status: "applied", appliedAt: Date.now() });
    const result = persist(db, taskId, { status: "done", step: PIPELINE_STEPS.length });
    // The payload is the undo contract: where to restore the task and the
    // application if this turns out to be a mis-click.
    appendEvent(db, {
      applicationId: task.applicationId,
      kind: "marked-submitted",
      payload: { prevStep: task.step, prevApplicationStatus },
    });
    return result;
  }

  // "fixed": only meaningful for an Action-Required task (status 2). The user
  // handled every outstanding field themselves, so every report still
  // needs-user (always outstanding) — or non-filled but required (the other
  // way a field lands in missingFields) — becomes "filled": the only outcome
  // fill-report-card.tsx renders in the resolved section. applicationInfo is
  // then rederived from those same reports (the applyFillReport pattern), so
  // the report card and the gate never disagree about what's resolved.
  if (task.applicationInfo?.status !== 2) {
    throw new ServiceError("task has no outstanding fields to resolve");
  }
  closeOpenHandoffsForTask(db, taskId);
  const resolvedReports: FieldReport[] = (task.fieldReports ?? []).map((r) => {
    if (r.outcome === "filled") return r;
    // Every force-flipped row — needs-user (never carried a real attempt; the
    // user filled the field on the page themselves) and required-but-failed
    // (the value is the attempted-but-never-written value) — would render
    // false provenance if the pre-write source/value survived
    // (fill-report-card.tsx renders "Label — source: value"). Clear both;
    // source "none" tells the card to render just the label.
    if (r.outcome === "needs-user" || r.required)
      return { ...r, outcome: "filled", value: undefined, source: "none" };
    return r;
  });
  // deriveApplicationInfo returns undefined for empty reports — a legacy row
  // (applicationInfo already set, fieldReports empty) would otherwise lose
  // its known fields. Fall back to the pre-Phase-8 merge instead of an empty
  // shell: fold missingFields into filledFields, clear missingFields, and
  // keep the existing totalFields.
  const existing = task.applicationInfo;
  const applicationInfo = deriveApplicationInfo(resolvedReports) ?? {
    status: 1 as const,
    filledFields: [...(existing?.filledFields ?? []), ...(existing?.missingFields ?? [])],
    missingFields: [],
    totalFields: existing?.totalFields,
  };
  return persist(db, taskId, {
    fieldReports: resolvedReports,
    applicationInfo,
    step: stepIndex("submit"),
    status: "awaiting_user",
  });
}

/**
 * The "mark submitted" terminal action. Valid only when the task waits at the
 * submit gate; finishes the task and marks the application applied.
 */
export function completeSubmitted(db: Db, taskId: string): AgentTask {
  const task = requireTask(db, taskId);
  if (task.status !== "awaiting_user" || PIPELINE_STEPS[task.step]?.key !== "submit") {
    throw new ServiceError("task is not at the submit gate");
  }
  const prevApplicationStatus = getApplication(db, task.applicationId)?.status;
  updateApplication(db, task.applicationId, { status: "applied", appliedAt: Date.now() });
  const result = persist(db, taskId, { status: "done", step: PIPELINE_STEPS.length });
  appendEvent(db, {
    applicationId: task.applicationId,
    kind: "marked-submitted",
    payload: { prevStep: task.step, prevApplicationStatus },
  });
  return result;
}

const UNDOABLE_APP_STATUSES = new Set(["saved", "applying"]);

/**
 * Undo a terminal "marked as submitted" — one-way doors get handles. Restores
 * the task to the gate it was completed from and the application to its
 * pre-applied status, both read from the completion event's payload (the
 * append-only ledger is what makes this restoration trustworthy). Completions
 * recorded before payloads existed restore to the submit gate. Appends
 * `submission-undone` so the reversal itself is on the timeline.
 */
export function undoSubmitted(db: Db, taskId: string): AgentTask {
  const task = requireTask(db, taskId);
  if (task.status !== "done") {
    throw new ServiceError("task is not completed — nothing to undo");
  }
  const lastMarked = [...listEvents(db, task.applicationId)]
    .reverse()
    .find((e) => e.kind === "marked-submitted");
  const payload = (lastMarked?.payload ?? {}) as {
    prevStep?: unknown;
    prevApplicationStatus?: unknown;
  };
  const prevStep =
    typeof payload.prevStep === "number" &&
    payload.prevStep >= 0 &&
    payload.prevStep < PIPELINE_STEPS.length
      ? payload.prevStep
      : stepIndex("submit");
  const prevApplicationStatus =
    typeof payload.prevApplicationStatus === "string" &&
    UNDOABLE_APP_STATUSES.has(payload.prevApplicationStatus)
      ? (payload.prevApplicationStatus as "saved" | "applying")
      : "applying";
  updateApplication(db, task.applicationId, { status: prevApplicationStatus, appliedAt: null });
  const result = persist(db, taskId, { status: "awaiting_user", step: prevStep });
  appendEvent(db, { applicationId: task.applicationId, kind: "submission-undone" });
  return result;
}

/**
 * The grounding inputs the `question-answer` LLM task needs for a task, drawn
 * from the same sources the fill bundle uses: profile facts, the raw JD text,
 * and the current tailored résumé. Kept here so the answer route never rebuilds
 * bundle assembly itself.
 */
export function buildQuestionContext(
  db: Db,
  taskId: string,
): { profileSummary: string; jdText: string; resumeText: string } {
  const task = requireTask(db, taskId);
  const application = getApplication(db, task.applicationId);
  const profile = getProfile(db);
  return {
    profileSummary: profile ? buildProfileFacts(profile) : "",
    jdText: application?.jdText ?? "",
    resumeText: currentVersionContent(getArtifact(db, taskId, "resume")) ?? "",
  };
}
