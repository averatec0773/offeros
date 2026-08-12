import {
  PIPELINE_STEPS,
  deriveApplicationInfo,
  mergeFieldReports,
  type PipelineTask,
  type Artifact,
  type FieldReport,
  type FillHandoff,
  type JobInfo,
  type Profile,
} from "@offeros/core";
import { formatEvidence, selectEvidence } from "@offeros/autofill";
import type { AnswerEntry, FillPersonalInfo, FillProfile } from "@offeros/autofill";
import type { Db } from "../db/client";
import {
  createPipelineTask,
  getPipelineTask,
  updatePipelineTask,
} from "../repositories/pipeline-task-repo";
import { getPipelineTaskByApplicationId } from "../repositories/pipeline-task-by-application";
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
import { listAnswers } from "../repositories/answer-repo";
import { buildProfileFacts, resolveEffectiveResume } from "../pipeline/steps/grounding";
import { listResumes } from "./resume-service";
import { recordFillOutcome } from "./form-memory";
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

/** Every open ticket for an APPLICATION, whatever task opened it. Submission is
 *  an application-level fact: a ticket left open by an earlier task would keep
 *  the application in "open to fill" long after it was sent. */
function closeOpenHandoffsForApplication(db: Db, applicationId: string): void {
  for (const handoff of listOpenFillHandoffs(db)) {
    if (handoff.applicationId === applicationId) {
      updateFillHandoff(db, handoff.id, { status: "completed" });
    }
  }
}

function requireTask(db: Db, taskId: string): PipelineTask {
  const task = getPipelineTask(db, taskId);
  if (!task) throw new ServiceError(`agent task ${taskId} not found`);
  return task;
}

function persist(
  db: Db,
  taskId: string,
  patch: Parameters<typeof updatePipelineTask>[2],
): PipelineTask {
  const updated = updatePipelineTask(db, taskId, patch);
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
  const parkedAt = PIPELINE_STEPS[task.step]?.key;
  if (task.status !== "awaiting_user" || (parkedAt !== "fill-form" && parkedAt !== "submit")) {
    throw new ServiceError("task is not awaiting fill");
  }
  // Re-filling from the submit gate: asking for a fill ticket IS the statement
  // that the run is not finished after all, so the task goes back to the fill
  // gate rather than refusing. It used to refuse — a completely successful fill
  // parks at submit, and from there every route back was a 400 the page showed
  // as "Something went wrong". There was no way out of a finished fill except
  // to mark it submitted.
  if (parkedAt === "submit") {
    updatePipelineTask(db, taskId, { step: stepIndex("fill-form"), status: "awaiting_user" });
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
    const task = getPipelineTaskByApplicationId(db, existing.id);
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

/**
 * The task id to generate materials against, creating or parking one as needed.
 *
 * The application page does not show tasks and the user does not know they
 * exist — but the generation steps and the extension both need one, parked at
 * the fill boundary, because that is the state `runTargetedStep` will run out
 * of band. Same auto-create the instant lane does, extended to re-park a task
 * left somewhere else by the pipeline UI that used to drive it.
 *
 * Deliberately does NOT touch a `running` task: something is mid-generation,
 * and parking it under itself would strand it. Callers surface that as "still
 * working" rather than starting a second run.
 *
 * Parking is safe for the extension: its pending list is built from open
 * handoffs, not from task state, so moving a task's step never resurrects an
 * application in the panel.
 */
export function ensureGenerationTask(db: Db, applicationId: string): string {
  const existing = getPipelineTaskByApplicationId(db, applicationId);
  if (!existing) return createFillFirstTask(db, applicationId);
  if (existing.status === "running") {
    throw new ServiceError("something is already generating for this application");
  }
  const parkedAt = PIPELINE_STEPS[existing.step]?.key;
  const parked =
    existing.status === "awaiting_user" && (parkedAt === "fill-form" || parkedAt === "submit");
  if (!parked) {
    updatePipelineTask(db, existing.id, {
      status: "awaiting_user",
      step: stepIndex("fill-form"),
    });
  }
  return existing.id;
}

/** A task born at the fill gate: `fillFirst` marks the skipped generation
 *  steps so the timeline renders them as skipped, never as done. */
function createFillFirstTask(db: Db, applicationId: string): string {
  return createPipelineTask(db, {
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
  /**
   * True when this task already finished a fill and is parked at the submit
   * gate. The panel keeps no state of its own across reloads, so this is the
   * only way a re-opened panel can know the run is already reported — without
   * it, Done looked available and did nothing.
   */
  taskParkedAtSubmit: boolean;
  /**
   * When this claim was made.
   *
   * A ticket can legitimately be claimed twice — a reloaded panel has to be
   * able to pick its own run back up, and refusing that would strand it. The
   * cost is that two panels can hold the same ticket at once (the toolbar side
   * panel and the in-page overlay are two shells of the same app), and both
   * report against the same task. There is no lease here; this is only enough
   * for a panel to find out it is no longer the current claimer instead of
   * quietly overwriting the other one's work.
   */
  claimedAt: number;
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

/** How rating questions are phrased around a topic. A pattern must contain a
 *  rating cue, so a committed level can only answer a question that is asking
 *  for one. */
const RATING_FRAMES: ((topic: string) => string)[] = [
  (t) => `rate your ${t}`,
  (t) => `rate your proficiency with ${t}`,
  (t) => `${t} proficiency`,
  (t) => `proficiency with ${t}`,
  (t) => `${t} experience level`,
  (t) => `level of ${t}`,
  (t) => `how would you rate ${t}`,
  (t) => `how often did you use ${t}`,
  (t) => `how frequently did you use ${t}`,
];

/** Questions that ask for links to work, in the wording forms actually use. */
const EVIDENCE_PATTERNS = [
  "links to any relevant work",
  "links to relevant work",
  "relevant work",
  "technical projects",
  "projects or write ups",
];
// Deliberately NOT "portfolio" / "personal website" / "github repositories":
// those are single-line link inputs the classifier already fills from the
// profile's own link fields, and a multi-project answer would be truncated at
// the first separator anyway.

/**
 * Answers derived from the profile for THIS job: the work worth showing, and
 * the ratings the user has already committed to.
 *
 * These ride the existing answer bank rather than a parallel mechanism, so
 * they inherit its matching, its provenance, and its precedence — a stored
 * answer always beats a derived one. Deriving them per job is the point: the
 * evidence chosen depends on what the job asks for.
 */
function derivedAnswers(profile: Profile | null, jobText: string): AnswerEntry[] {
  if (!profile) return [];
  const out: AnswerEntry[] = [];

  const chosen = selectEvidence(profile.evidence ?? [], jobText);
  if (chosen.length > 0) {
    out.push({
      id: "derived:evidence",
      questionPatterns: EVIDENCE_PATTERNS,
      answer: formatEvidence(chosen),
      type: "text",
      category: "custom",
      derived: true,
    });
  }

  // One entry per committed rating — but the bare topic must NOT be the
  // pattern. A topic like "Go" or "R" appears inside ordinary prose ("how far
  // are you willing to go…"), and a derived entry arrives as `fillable`, so a
  // one-word rating would be typed into an unrelated field with no guard and
  // no review. Only rating-SHAPED questions match.
  for (const assessment of profile.selfAssessments ?? []) {
    const topic = assessment.topic.trim();
    if (topic === "") continue;
    out.push({
      id: `derived:self-assessment:${assessment.id}`,
      questionPatterns: RATING_FRAMES.map((frame) => frame(topic)),
      answer: assessment.level,
      type: "enum",
      category: "custom",
      derived: true,
    });
  }
  return out;
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
/**
 * The profile the fill engine resolves values from: the user's own facts, their
 * stored answers, and the answers we derived for this specific job.
 *
 * Extracted from `claimHandoff` because the AI fallback classifier resolves its
 * mappings against exactly this — the same profile, the same answer bank, the
 * same precedence. Two assemblies would mean the fallback could fill from a
 * bank the ordinary path does not have, which is the kind of divergence nobody
 * notices until a value is wrong on a submitted application.
 */
export function buildFillProfile(db: Db, applicationId: string): FillProfile {
  const profile = getProfile(db);
  const application = getApplication(db, applicationId);
  return {
    personal: toFillPersonal(profile),
    skills: profile?.skills ?? [],
    // The stored bank first: an answer the user wrote always wins over one we
    // derived. The derived entries below only cover questions the bank has
    // nothing for.
    answerBank: [
      ...(listAnswers(db) as AnswerEntry[]),
      ...derivedAnswers(
        profile,
        `${application?.jobInfo.jobTitle ?? ""} ${application?.jdText ?? ""}`,
      ),
    ],
  };
}

export function claimHandoff(db: Db, handoffId: string): FillTaskBundle {
  const handoff = getFillHandoff(db, handoffId);
  if (!handoff) throw new ServiceError(`fill handoff ${handoffId} not found`);
  if (handoff.status !== "pending" && handoff.status !== "claimed") {
    throw new ServiceError(`fill handoff ${handoffId} is not open`);
  }

  const task = requireTask(db, handoff.taskId);
  const application = getApplication(db, handoff.applicationId);
  const jdAnalysis = getJdAnalysis(db, handoff.applicationId);
  const effectiveResume = resolveEffectiveResume(
    { resumeId: application?.resumeId },
    listResumes(db),
  );

  const fillProfile = buildFillProfile(db, handoff.applicationId);

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
    taskParkedAtSubmit: PIPELINE_STEPS[task.step]?.key === "submit",
    claimedAt: Date.now(),
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
): PipelineTask {
  const task = requireTask(db, taskId);
  const parkedAt = PIPELINE_STEPS[task.step]?.key;
  // Replaying a complete report is allowed, and has to be.
  //
  // A status-1 complete report moves the task to the submit gate. The panel
  // does not persist "I already reported", so re-opening it and pressing Done
  // again sent the same complete report to a task that had moved on — and this
  // guard rejected it with a 400. The panel then set doneRef=false and
  // returned in silence: the user pressed Done, nothing happened, and nothing
  // said why.
  //
  // Accepting it is safe precisely because a complete report REPLACES rather
  // than merges: the same snapshot twice lands the same state twice.
  // Both gates accept a report, and for the same reason: between finishing a
  // fill and actually pressing submit on the employer's page, the user is still
  // working. They refine a generated answer, accept a better one, fix a field
  // by hand — and the panel reports each of those as it happens. Refusing them
  // because the task had moved to the submit gate meant the workspace's record
  // of the fill silently stopped matching the page the moment it mattered most.
  //
  // A COMPLETE report replayed at the submit gate is safe for the same reason:
  // complete replaces, so the same snapshot twice lands the same state twice.
  // What is still refused is a report against a FINISHED task — once the user
  // has said they submitted, a late report from a stale panel must not reopen
  // the record.
  if (task.status !== "awaiting_user" || (parkedAt !== "fill-form" && parkedAt !== "submit")) {
    throw new ServiceError("task is not awaiting fill");
  }
  // A COMPLETE report replaces; an incremental one merges.
  //
  // The panel accumulates every page's reports in one map and re-sends the
  // whole set, so a complete report is an authoritative snapshot of the run —
  // not a delta. Merging it left anything the snapshot no longer contains
  // alive forever, which is how stale "needs you" rows outlived the fields
  // that produced them and pinned applications at "needs you" permanently.
  //
  // This is also the repair: rows polluted by the old unstable page key
  // disappear the next time the user completes a fill. No migration needed.
  const merged = complete ? reports : mergeFieldReports(task.fieldReports ?? [], reports);
  const applicationInfo = deriveApplicationInfo(merged);

  let result: PipelineTask;
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

  if (complete) rememberForm(db, task.applicationId, taskId, merged);

  return result;
}

/**
 * Write this fill into form memory. Bookkeeping, in the same sense as
 * `appendEvent`: it runs after the fill has already been persisted and it must
 * never be able to break one. A form the engine cannot record is a form the
 * engine still filled, and the user is standing in front of the page waiting.
 *
 * Recorded ONCE per task, guarded by a marker event rather than by trusting
 * the caller. An Action-Required fill leaves the task parked at fill-form, so
 * a second complete report (a double-clicked Done, a re-fill of the same page)
 * passes the state guard above and would silently inflate `seen_count` — the
 * recurrence number the whole learning decision reads. The gate lives here,
 * inside the tool, because callers cannot be trusted to submit exactly once.
 * Accepted trade-off: a re-fill that reaches NEW questions (a later wizard
 * page) is not re-recorded either; one undercounted page beats every
 * double-click permanently corrupting the denominator.
 */
function rememberForm(db: Db, applicationId: string, taskId: string, reports: FieldReport[]): void {
  try {
    const alreadyRecorded = listEvents(db, applicationId).some(
      (event) =>
        event.kind === "form-memory-recorded" &&
        (event.payload as { taskId?: unknown } | undefined)?.taskId === taskId,
    );
    if (alreadyRecorded) return;
    recordFillOutcome(db, {
      applicationId,
      taskId,
      applyLink: getApplication(db, applicationId)?.jobInfo.applyLink,
      reports,
    });
    appendEvent(db, { applicationId, kind: "form-memory-recorded", payload: { taskId } });
  } catch (error) {
    console.error("[fill-service] recording form memory failed:", error);
  }
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
  /** Which button was pressed — the panel's or the web card's. Recorded on the
   *  event so the timeline can say where a submission came from. */
  source: SubmissionSource = "panel",
): PipelineTask {
  const task = requireTask(db, taskId);

  if (action === "applied-manually") {
    // Valid from either awaiting_user gate the user can be sitting on: the
    // fill-form (Action Required) gate or the submit gate.
    const stepKey = PIPELINE_STEPS[task.step]?.key;
    if (task.status !== "awaiting_user" || (stepKey !== "fill-form" && stepKey !== "submit")) {
      throw new ServiceError("task is not awaiting a fill resolution");
    }
    return markSubmitted(db, task.applicationId, source) ?? task;
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
/**
 * Is this ticket still the one this task is being filled through?
 *
 * Answers the two-panels case without introducing a lease: the newest open
 * ticket for a task is the current one, and a report arriving on an older
 * ticket comes from a panel that has been superseded. The report is still
 * applied — throwing it away would lose real work the user did on a real page —
 * but the panel is told, so it can say so instead of silently fighting the
 * other one.
 */
export function isCurrentClaim(db: Db, taskId: string, handoffId: string): boolean {
  const open = listOpenFillHandoffs(db).filter((h) => h.taskId === taskId);
  if (open.length === 0) return true; // nothing open: nobody to conflict with
  return open[0]?.id === handoffId;
}

/** Where a "I submitted this" came from. Recorded so the timeline can say. */
export const SUBMISSION_SOURCES = ["panel", "web-card", "web-status", "agent"] as const;
export type SubmissionSource = (typeof SUBMISSION_SOURCES)[number];

/**
 * Submitting an application is one act, so it is one function.
 *
 * There used to be four ways to say "I sent this" and they wrote three
 * different states. The panel's button closed the ticket, set the status and
 * the date, finished the task and left an undo record. The agent's tool did
 * everything except close the ticket, so the application stayed in the
 * extension's "open to fill" list after it was sent. And the web status
 * dropdown wrote `status = "applied"` and nothing else: no date, no event, the
 * task still parked at the fill gate, the ticket still open — and no way back,
 * because undo restores from the event that path never wrote.
 *
 * All five things happen here or they do not happen:
 *   1. every open ticket for the application is closed,
 *   2. the application reads applied, with the date,
 *   3. its task, if it has one, is finished,
 *   4. a `marked-submitted` event records where this came from,
 *   5. and that event carries what undo needs to put everything back.
 *
 * An application with no task is a legitimate case (added by link, filled by
 * hand, never opened in the panel) — the other four still apply.
 */
export function markSubmitted(
  db: Db,
  applicationId: string,
  source: SubmissionSource,
): PipelineTask | null {
  const application = getApplication(db, applicationId);
  if (!application) throw new ServiceError(`application ${applicationId} not found`);
  if (application.status === "applied") {
    // Idempotent by design: two of these entry points are buttons a user can
    // press twice, and the second press must not overwrite the first press's
    // undo record with a `prevApplicationStatus` of "applied".
    return getPipelineTaskByApplicationId(db, applicationId);
  }

  closeOpenHandoffsForApplication(db, applicationId);
  const task = getPipelineTaskByApplicationId(db, applicationId);
  updateApplication(db, applicationId, { status: "applied", appliedAt: Date.now() });
  const result = task
    ? persist(db, task.id, { status: "done", step: PIPELINE_STEPS.length })
    : null;
  // The payload is the undo contract: where to restore the task and the
  // application if this turns out to be a mis-click.
  appendEvent(db, {
    applicationId,
    kind: "marked-submitted",
    payload: { source, prevStep: task?.step, prevApplicationStatus: application.status },
  });
  return result;
}

export function completeSubmitted(db: Db, taskId: string): PipelineTask {
  const task = requireTask(db, taskId);
  if (task.status !== "awaiting_user" || PIPELINE_STEPS[task.step]?.key !== "submit") {
    throw new ServiceError("task is not at the submit gate");
  }
  return markSubmitted(db, task.applicationId, "agent") ?? task;
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
export function undoSubmitted(db: Db, taskId: string): PipelineTask {
  const task = requireTask(db, taskId);
  if (task.status !== "done") {
    throw new ServiceError("task is not completed — nothing to undo");
  }
  const restored = undoSubmittedForApplication(db, task.applicationId);
  return restored ?? task;
}

/**
 * Undo by application, which is the level submission actually happens at.
 *
 * Every entry point now writes the same `marked-submitted` event, so every
 * entry point is undoable — including the status dropdown, which used to write
 * nothing to restore from and left the user with no way back. An application
 * that never had a task is undone too; there is simply no task to restore.
 */
export function undoSubmittedForApplication(db: Db, applicationId: string): PipelineTask | null {
  const application = getApplication(db, applicationId);
  if (!application) throw new ServiceError(`application ${applicationId} not found`);
  const lastMarked = [...listEvents(db, applicationId)]
    .reverse()
    .find((e) => e.kind === "marked-submitted");
  if (!lastMarked) {
    throw new ServiceError("this application was not marked as submitted here");
  }
  const payload = (lastMarked.payload ?? {}) as {
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
  updateApplication(db, applicationId, { status: prevApplicationStatus, appliedAt: null });
  const task = getPipelineTaskByApplicationId(db, applicationId);
  const result = task ? persist(db, task.id, { status: "awaiting_user", step: prevStep }) : null;
  appendEvent(db, { applicationId, kind: "submission-undone" });
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
