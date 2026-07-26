import type { FillProfile } from "@offeros/autofill";
import { settings } from "./settings";

/**
 * Fetch wrapper over apps/web's `/api/v1` envelope. Never throws to callers —
 * network failure, a non-ok envelope, and malformed JSON all collapse to
 * `{ ok: false, error }` so standalone mode (web app not running) degrades
 * cleanly instead of surfacing an unhandled rejection.
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
  body: { question: string; label: string; context?: string; existingAnswer?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<{ answer: string }>> {
  return call<{ answer: string }>(`/agent/tasks/${taskId}/fill/answer`, json("POST", body), fetchImpl);
}
