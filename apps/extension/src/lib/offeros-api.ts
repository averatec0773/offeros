import type { FillProfile } from "@offeros/autofill";
import { settings } from "./settings";

/**
 * Fetch wrapper over apps/web's `/api/v1` envelope. Never throws to callers —
 * network failure, a non-ok envelope, and malformed JSON all collapse to
 * `{ ok: false, error }` so a stopped web app degrades cleanly (panel banner)
 * instead of surfacing an unhandled rejection.
 */
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Mirrors apps/web's `FillTicket` (FillHandoff + job header) structurally — no import across the app boundary. */
export type FillTicket = {
  id: string;
  taskId: string;
  applicationId: string;
  applyLink?: string;
  status: "pending" | "claimed" | "completed" | "cancelled";
  createdAt: number;
  updatedAt: number;
  job: { title: string; company: string; applyLink?: string };
};

/** Mirrors apps/web's `FillTaskBundle` (fill-service.ts) structurally. */
export type FillTaskBundle = {
  handoffId: string;
  taskId: string;
  applicationId: string;
  job: { title: string; company: string; applyLink?: string };
  fillProfile: FillProfile;
  resumeText: string | null;
  coverLetterText: string | null;
  jdSummary: string | null;
  /** Which stored résumé file to attach to the ATS's file input: the AI-tailored
   *  PDF export, or the user's original uploaded file (`resumeId` below). */
  attachResume: "tailored" | "original";
  /** The application's effective résumé id — present so the panel can fetch the
   *  original stored file via `fetchResumeFile` when `attachResume` is "original".
   *  Undefined when the account has no résumés at all. */
  resumeId?: string;
  /** The task's accumulated per-field reports — present so a re-claiming
   *  panel (extension reloaded mid-fill) rehydrates instead of restarting. */
  fieldReports?: FieldReport[];
};

/** Mirrors apps/web's `Application` structurally, trimmed to what the panel needs. */
export type ApplicationSummary = {
  id: string;
  jobInfo: { jobTitle: string; companyName: string; applyLink?: string };
};

/** Mirrors apps/web's `AnswerEntry` (@offeros/core `answerSchema`) structurally. */
export type AnswerEntry = {
  id: string;
  questionPatterns: string[];
  answer: string;
  type: "enum" | "text" | "number" | "boolean";
  category: "eeo" | "screening" | "custom";
};

export type FieldReportOutcome = "filled" | "skipped" | "needs-user" | "failed";

/** Mirrors @offeros/core's `FieldReport` structurally. */
export type FieldReport = {
  fieldId: string;
  label: string;
  classifiedType: string;
  status: string;
  value?: string;
  source: string;
  reason: string;
  outcome: FieldReportOutcome;
  required: boolean;
  page?: string;
};

type Envelope<T> = {
  success: boolean;
  errorCode: number;
  errorMsg: string | null;
  result: T | null;
};

const OK_CODE = 10000;

async function call<T>(
  path: string,
  init: RequestInit | undefined,
  fetchImpl: typeof fetch,
): Promise<ApiResult<T>> {
  const base = await settings.webApiBase.getValue();
  let response: Response;
  try {
    response = await fetchImpl(`${base}/api/v1${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    return { ok: false, error: "network error" };
  }
  let body: Envelope<T>;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    return { ok: false, error: "malformed response" };
  }
  if (!body.success || body.errorCode !== OK_CODE) {
    return { ok: false, error: body.errorMsg ?? "request failed" };
  }
  return { ok: true, value: body.result as T };
}

const json = (method: string, payload: unknown): RequestInit => ({
  method,
  body: JSON.stringify(payload),
});

/** A raw file fetch (résumé bytes / rendered PDF) — not the JSON envelope,
 *  since these routes stream bytes on success. A non-2xx response collapses to
 *  `{ ok: false, status }` (network error / malformed response omit `status`),
 *  never throws to the caller. `status` lets callers tell a 404 (nothing
 *  stored to attach) apart from a 400 (the artifact exists but failed to
 *  render) so they can surface a different, honest reason for each. */
export type FileFetchResult =
  | { ok: true; bytes: ArrayBuffer; fileName: string; mimeType: string }
  | { ok: false; status?: number };

/** Content-Disposition filename: prefers the RFC 5987 UTF-8 form (matches
 *  non-ASCII names like "Résumé.pdf"), falls back to the ASCII `filename="…"`. */
function parseFilename(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      // fall through to the ASCII form
    }
  }
  const ascii = /filename="([^"]*)"/i.exec(header);
  return ascii?.[1] ?? null;
}

async function fetchFile(path: string, fetchImpl: typeof fetch): Promise<FileFetchResult> {
  const base = await settings.webApiBase.getValue();
  let response: Response;
  try {
    response = await fetchImpl(`${base}/api/v1${path}`);
  } catch {
    return { ok: false };
  }
  if (!response.ok) return { ok: false, status: response.status };
  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    return { ok: false };
  }
  const fileName = parseFilename(response.headers.get("content-disposition")) ?? "file";
  const mimeType = response.headers.get("content-type") ?? "application/octet-stream";
  return { ok: true, bytes, fileName, mimeType };
}

/** Fetch a stored résumé's original bytes (`attachResume: "original"`). */
export function fetchResumeFile(
  resumeId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FileFetchResult> {
  return fetchFile(`/resumes/${resumeId}/file`, fetchImpl);
}

/** Fetch a task's rendered artifact PDF — the tailored résumé, or the cover letter. */
export function fetchArtifactPdf(
  taskId: string,
  kind: "resume" | "cover-letter",
  fetchImpl: typeof fetch = fetch,
): Promise<FileFetchResult> {
  return fetchFile(`/agent/tasks/${taskId}/artifacts/${kind}/pdf`, fetchImpl);
}

export function getPending(fetchImpl: typeof fetch = fetch): Promise<ApiResult<FillTicket[]>> {
  return call<FillTicket[]>("/agent/fill/pending", undefined, fetchImpl);
}

export function claim(
  handoffId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<FillTaskBundle>> {
  return call<FillTaskBundle>(`/agent/fill/handoffs/${handoffId}/claim`, json("POST", {}), fetchImpl);
}

export function postReport(
  taskId: string,
  reports: FieldReport[],
  complete?: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<unknown>> {
  return call<unknown>(
    `/agent/tasks/${taskId}/fill/report`,
    json("POST", { reports, complete }),
    fetchImpl,
  );
}

export function generateAnswer(
  taskId: string,
  body: {
    question: string;
    label: string;
    context?: string;
    options?: string[];
    existingAnswer?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<{ answer: string }>> {
  return call<{ answer: string }>(`/agent/tasks/${taskId}/fill/answer`, json("POST", body), fetchImpl);
}

/** The full answer bank (`GET /answers`) — used to dedup an accepted AI answer against
 *  an existing entry before deciding create vs. update. */
export function listAnswers(fetchImpl: typeof fetch = fetch): Promise<ApiResult<AnswerEntry[]>> {
  return call<AnswerEntry[]>("/answers", undefined, fetchImpl);
}

/** Persist a newly-accepted AI answer as a new answer-bank entry (single question pattern:
 *  the field label as asked). */
export function createAnswer(
  input: { question: string; answer: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<AnswerEntry>> {
  return call<AnswerEntry>(
    "/answers",
    json("POST", {
      questionPatterns: [input.question],
      answer: input.answer,
      type: "text",
      category: "custom",
    }),
    fetchImpl,
  );
}

/** Overwrite an existing answer-bank entry's text (re-accepting the same question).
 *  Answer-only patch — deliberately omits `questionPatterns`: the entry was already
 *  matched by an existing pattern, and the web repo's PUT merges the patch via object
 *  spread, so sending `questionPatterns: [label]` here would clobber every other
 *  pattern a curated multi-pattern entry carries. */
export function updateAnswer(
  id: string,
  input: { answer: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<AnswerEntry>> {
  return call<AnswerEntry>(`/answers/${id}`, json("PUT", { answer: input.answer }), fetchImpl);
}

/** Dedup lookup for "Add this job": exact-match applications already tracking this job URL. */
export function findApplicationsByJobUrl(
  jobUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<ApplicationSummary[]>> {
  return call<ApplicationSummary[]>(
    `/applications?jobUrl=${encodeURIComponent(jobUrl)}`,
    undefined,
    fetchImpl,
  );
}

/** One-click instant fill: create-or-reuse this page's application plus a
 *  fill-gate task, open a ticket, and claim it in one call — the response is
 *  the same FillTaskBundle the workspace lane hands out, so the panel's
 *  existing task-mode flow takes over unchanged. A mid-pipeline application
 *  comes back as an envelope error ("already tracked…"). */
export function instantFill(
  input: { jobTitle: string; companyName: string; jobUrl: string; jdText: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<FillTaskBundle>> {
  return call<FillTaskBundle>(
    "/agent/fill/instant",
    json("POST", {
      jobInfo: {
        jobId: crypto.randomUUID(),
        jobTitle: input.jobTitle,
        companyName: input.companyName,
        applyLink: input.jobUrl,
      },
      jdText: input.jdText,
    }),
    fetchImpl,
  );
}

/** Mirrors apps/web's `FitAnalysis` structurally, trimmed to what the panel shows. */
export type FitSummary = {
  overall: number;
  label: string;
  whyMatch: string;
  subScores: { experience: number; skills: number; education: number };
  notAlignedSkills: { skill: string; advice: string }[];
};

/** The stored fit for an application; `{ ok: false }` when none has been computed yet. */
export function getFit(
  applicationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<FitSummary>> {
  return call<FitSummary>(`/applications/${applicationId}/fit`, undefined, fetchImpl);
}

/** Compute (or recompute) the fit — an LLM call; resolves with the fresh row. */
export function computeFit(
  applicationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<FitSummary>> {
  return call<FitSummary>(`/applications/${applicationId}/fit`, json("POST", {}), fetchImpl);
}

/** Resolve the fill run from the panel: the user applied manually / marked done.
 *  Marks the task done and the application applied (server-side resolveFill). */
export function resolveFillAction(
  taskId: string,
  action: "fixed" | "applied-manually",
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<unknown>> {
  return call<unknown>(`/agent/tasks/${taskId}/fill/resolve`, json("POST", { action }), fetchImpl);
}

/** Undo a mark-as-submitted: the task returns to its pre-completion gate. */
export function undoSubmission(
  taskId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<unknown>> {
  return call<unknown>(`/agent/tasks/${taskId}/fill/undo`, json("POST", {}), fetchImpl);
}

/** Ledger a self-recovery attempt (best-effort bookkeeping; callers ignore failures). */
export function postRepairEvent(
  taskId: string,
  kind: "repair-attempted" | "repair-succeeded" | "repair-failed",
  payload: { failure: string; action: string; detail?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<unknown>> {
  return call<unknown>(`/agent/tasks/${taskId}/repair-event`, json("POST", { kind, payload }), fetchImpl);
}

/** In-panel "Tailor résumé for this job": run the tailor step out of band for a
 *  task parked at the fill/submit gate. Long-running (an LLM call) — resolves
 *  when the resume artifact exists, ready for `fetchArtifactPdf` preview. */
export function tailorResume(
  taskId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<unknown>> {
  return call<unknown>(`/agent/tasks/${taskId}/tailor`, json("POST", {}), fetchImpl);
}

/** In-panel "Write cover letter": run the cover-letter step out of band —
 *  grounded on the tailored résumé artifact when one exists, else profile
 *  facts. Same contract as `tailorResume`. */
export function generateCoverLetter(
  taskId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<unknown>> {
  return call<unknown>(`/agent/tasks/${taskId}/cover-letter`, json("POST", {}), fetchImpl);
}

/** One-click "Add this job": creates the application + task from captured JD text in one call. */
export function createTaskFromJd(
  input: { jobTitle: string; companyName: string; jobUrl: string; jdText: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<{ id: string; applicationId: string }>> {
  return call<{ id: string; applicationId: string }>(
    "/agent/tasks",
    json("POST", {
      jobInfo: {
        jobId: crypto.randomUUID(),
        jobTitle: input.jobTitle,
        companyName: input.companyName,
        applyLink: input.jobUrl,
      },
      jdText: input.jdText,
      source: "extension",
    }),
    fetchImpl,
  );
}
