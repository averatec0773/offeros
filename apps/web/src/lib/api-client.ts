import type {
  AnswerEntry,
  Application,
  PipelineTask,
  ApplicationEvent,
  ApplicationStatus,
  Artifact,
  ArtifactVersion,
  FillHandoff,
  FitAnalysis,
  JdAnalysis,
  JobInfo,
  Profile,
  ResumeSummary,
  Settings,
  Template,
} from "@offeros/core";
import type { ParsedResume } from "@offeros/llm";
import type { StyleMemoryKind, StyleMemorySetting } from "@/server/repositories/style-memory-repo";
import type { QueueStatus } from "@/server/services/queue-service";
import type { AgentStep } from "@/server/agent/loop";
import type { FillStats } from "@offeros/autofill";
import type { TraceEntry } from "@/server/agent/types";
import type { AttentionItem } from "@/server/services/attention-service";
import type { ReconResult } from "@/server/services/recon-service";
import type { RequirementsSummary } from "@/server/services/requirements-service";
import type { LineDiff } from "./diff";

export class ApiError extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

/** Mirrors envelope.ts's `ERROR_CODES.NO_API_KEY` (42000) without importing server code into the client bundle. */
const NO_API_KEY_CODE = 42000;

/**
 * `Settings` minus `llm.apiKeys` — the shape the client ever actually sees.
 * `/settings` (GET/PUT) strips raw keys server-side before responding, so
 * typing the client surface as `Settings` was a lie the client never reads
 * true; this type says what's really there instead.
 */
export type ClientSettings = Omit<Settings, "llm"> & {
  llm: Omit<Settings["llm"], "apiKeys">;
};

/** True only for the "no provider key configured" envelope, never for test-llm's plain 400s. */
export function isLlmNotConfigured(err: unknown): boolean {
  return err instanceof ApiError && err.code === NO_API_KEY_CODE;
}

type Envelope<T> = {
  success: boolean;
  errorCode: number;
  errorMsg: string | null;
  result: T | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as Envelope<T>;
  if (!body.success) throw new ApiError(body.errorMsg ?? "request failed", body.errorCode);
  return body.result as T;
}

const json = (method: string, payload: unknown): RequestInit => ({
  method,
  body: JSON.stringify(payload),
});

export const api = {
  profile: {
    save: (profile: Profile) => request<Profile>("/profile", json("PUT", profile)),
    parseResume: (input: { resumeText: string }) =>
      request<ParsedResume>("/profile/parse-resume", json("POST", input)),
  },
  applications: {
    update: (
      id: string,
      patch: Partial<{
        status: ApplicationStatus;
        notes: string;
        jdText: string;
        jdSource: string;
        resumeId: string;
        attachResume: "tailored" | "original";
        appliedAt: number;
      }>,
    ) => request<Application>(`/applications/${id}`, json("PATCH", patch)),
    get: (id: string) => request<Application>(`/applications/${id}`),
    events: (id: string) => request<ApplicationEvent[]>(`/applications/${id}/events`),
    trace: (id: string) => request<TraceEntry[]>(`/applications/${id}/trace`),
    /** Track a job from its link. Returns the existing one, flagged, when the
     *  posting is already tracked. */
    create: (url: string) =>
      request<{ application: Application; duplicate: boolean; recon?: ReconResult }>(
        "/applications",
        json("POST", { url }),
      ),
    /** Check whether the posting is still up, and learn what its form asks. */
    recon: (id: string) => request<ReconResult>(`/applications/${id}/recon`, json("POST", {})),
    /** How many tracked jobs have no description yet. */
    backfillCount: () => request<{ missing: number; cap: number }>("/applications/backfill-jd"),
    /** Re-run extraction for those, and report what happened to each. */
    backfillJd: () =>
      request<{
        considered: number;
        filled: number;
        failed: number;
        results: { id: string; job: string; ok: boolean; detail: string }[];
      }>("/applications/backfill-jd", json("POST", {})),
    /** The stored AI reading of this posting. */
    jdAnalysis: (id: string) => request<JdAnalysis>(`/applications/${id}/jd-analysis`),
    /** Read the posting with the model — one call, on the user's key. */
    analyzeJd: (id: string, instruction?: string) =>
      request<JdAnalysis>(
        `/applications/${id}/jd-analysis`,
        json("POST", instruction ? { instruction } : {}),
      ),
    /** What the form asks and how much of it we can already answer. */
    requirements: (id: string) => request<RequirementsSummary>(`/applications/${id}/requirements`),
    /** The generation task for this application, created on demand. The page
     *  does not show tasks; this is only how it reaches the same targeted
     *  generation endpoints the browser panel uses. */
    ensureTask: (id: string) =>
      request<{ taskId: string; task: PipelineTask; artifacts: Artifact[] }>(
        `/applications/${id}/task`,
        json("POST", {}),
      ),
  },
  pipelineTasks: {
    create: (input: { applicationId: string }) =>
      request<PipelineTask>("/agent/tasks", json("POST", input)),
    createFromJd: (input: { jobInfo: JobInfo; jdText?: string; source?: string }) =>
      request<PipelineTask>("/agent/tasks", json("POST", input)),
    get: (id: string) =>
      request<{ task: PipelineTask; jdAnalysis: JdAnalysis | null; artifacts: Artifact[] }>(
        `/agent/tasks/${id}`,
      ),
    start: (id: string) => request<PipelineTask>(`/agent/tasks/${id}/start`, json("POST", {})),
    advance: (id: string) => request<PipelineTask>(`/agent/tasks/${id}/advance`, json("POST", {})),
    tweak: (id: string, kind: "resume" | "cover-letter", instruction: string) =>
      request<{ version: ArtifactVersion; diff: LineDiff }>(
        `/agent/tasks/${id}/tweak`,
        json("POST", { kind, instruction }),
      ),
    choice: (id: string, choice: "skip" | "generate") =>
      request<PipelineTask>(`/agent/tasks/${id}/choice`, json("POST", { choice })),
    pause: (id: string) => request<PipelineTask>(`/agent/tasks/${id}/pause`, json("POST", {})),
    fillHandoff: (id: string) =>
      request<FillHandoff>(`/agent/tasks/${id}/fill/handoff`, json("POST", {})),
    fillResolve: (id: string, action: "fixed" | "applied-manually") =>
      request<PipelineTask>(`/agent/tasks/${id}/fill/resolve`, json("POST", { action })),
    fillUndo: (id: string) =>
      request<PipelineTask>(`/agent/tasks/${id}/fill/undo`, json("POST", {})),
    /** Generate (or re-generate) the tailored résumé — the same targeted
     *  endpoint the browser panel uses. */
    tailor: (id: string) => request<PipelineTask>(`/agent/tasks/${id}/tailor`, json("POST", {})),
    coverLetter: (id: string) =>
      request<PipelineTask>(`/agent/tasks/${id}/cover-letter`, json("POST", {})),
    /** Accept a generated document: timeline event + style-memory learning. */
    approveArtifact: (id: string, kind: "resume" | "cover-letter") =>
      request<{ approved: boolean; kind: string }>(
        `/agent/tasks/${id}/artifacts/${kind}/approve`,
        json("POST", {}),
      ),
  },
  agent: {
    inbox: () => request<{ inbox: AttentionItem[]; trace: TraceEntry[] }>(`/agent/inbox`),
    /** Fill quality across every application, computed from the field reports. */
    stats: () => request<FillStats>(`/agent/stats`),
    /** One turn of the agent chat. The steps come back with the answer so the
     *  UI can show what was read to produce it. */
    /** Omit applicationId to talk about every application. */
    chat: (question: string, applicationId?: string) =>
      request<{ answer: string; steps: AgentStep[]; ranOutOfSteps: boolean }>(
        `/agent/chat`,
        json("POST", { question, ...(applicationId ? { applicationId } : {}) }),
      ),
    /** The persisted thread for a scope (this application, or global). */
    chatHistory: (applicationId?: string) =>
      request<
        {
          id: string;
          role: "user" | "assistant";
          content: string;
          steps?: unknown[];
          ranOutOfSteps?: boolean;
          at: number;
        }[]
      >(`/agent/chat/history${applicationId ? `?applicationId=${applicationId}` : ""}`),
  },
  queue: {
    status: () => request<QueueStatus>(`/agent/queue`),
    start: (applicationIds: string[]) =>
      request<{ status: QueueStatus; skipped: { applicationId: string; reason: string }[] }>(
        `/agent/queue`,
        json("POST", { applicationIds }),
      ),
    pause: () => request<QueueStatus>(`/agent/queue/pause`, json("POST", {})),
  },
  fit: {
    recompute: (applicationId: string) =>
      request<FitAnalysis>(`/applications/${applicationId}/fit`, json("POST", {})),
  },
  settings: {
    get: () => request<ClientSettings>("/settings"),
    save: (settings: ClientSettings) => request<ClientSettings>("/settings", json("PUT", settings)),
    llmKeys: () => request<Record<string, "saved" | "env" | "none">>("/settings/llm-keys"),
    setLlmKey: (provider: string, key: string) =>
      request<Record<string, "saved" | "env" | "none">>(
        "/settings/llm-keys",
        json("PUT", { provider, key }),
      ),
    testLlm: (input: { provider: string; model?: string; key?: string }) =>
      request<{ ok: true }>("/settings/test-llm", json("POST", input)),
    style: {
      list: () => request<StyleMemorySetting[]>("/settings/style"),
      update: (kind: StyleMemoryKind, patch: { notes?: string; enabled?: boolean }) =>
        request<StyleMemorySetting[]>("/settings/style", json("PUT", { kind, ...patch })),
    },
  },
  resumes: {
    list: () => request<ResumeSummary[]>("/resumes"),
    upload: (input: {
      name: string;
      mimeType: string;
      dataBase64: string;
      isPrimary?: boolean;
      text?: string;
    }) => request<ResumeSummary>("/resumes", json("POST", input)),
    setPrimary: (id: string) =>
      request<ResumeSummary>(`/resumes/${id}`, json("PATCH", { isPrimary: true })),
    update: (id: string, patch: Partial<{ name: string; note: string; isPrimary: boolean }>) =>
      request<ResumeSummary>(`/resumes/${id}`, json("PATCH", patch)),
    remove: (id: string) => request<{ id: string }>(`/resumes/${id}`, { method: "DELETE" }),
  },
  answers: {
    list: () => request<AnswerEntry[]>("/answers"),
    create: (input: Omit<AnswerEntry, "id">) =>
      request<AnswerEntry>("/answers", json("POST", input)),
    update: (id: string, patch: Partial<Omit<AnswerEntry, "id">>) =>
      request<AnswerEntry>(`/answers/${id}`, json("PUT", patch)),
    remove: (id: string) => request<{ id: string }>(`/answers/${id}`, { method: "DELETE" }),
  },
  templates: {
    list: () => request<Template[]>("/templates"),
    save: (input: {
      id?: string;
      name: string;
      kind: string;
      renderer: string;
      content: string;
      scaffoldHints?: string;
      isDefault?: boolean;
    }) => request<Template>("/templates", json("POST", input)),
    update: (
      id: string,
      input: {
        name: string;
        kind: string;
        renderer: string;
        content: string;
        scaffoldHints?: string;
        isDefault?: boolean;
      },
    ) => request<Template>(`/templates/${id}`, json("PUT", input)),
    remove: (id: string) => request<{ id: string }>(`/templates/${id}`, { method: "DELETE" }),
    analyze: (input: { content: string; filename?: string }) =>
      request<{
        contentWithMarkers: string;
        bodyPreview: string;
        scaffoldHints: string;
        detected: boolean;
        warnings: string[];
      }>("/templates/analyze", json("POST", input)),
    /** Streams the preview PDF (or surfaces the enveloped error) — the response
     *  is not JSON on success, so this bypasses `request` and reads the fetch
     *  Response directly, mirroring how the workspace's downloadPdf handles the
     *  artifact PDF endpoint. */
    preview: async (
      input: { content: string; renderer: string; scaffoldHints?: string } | { id: string },
    ): Promise<{ ok: true; blob: Blob } | { ok: false; error: string; logExcerpt?: string }> => {
      const response = await fetch("/api/v1/templates/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const envelope = (await response.json().catch(() => null)) as Envelope<never> | null;
        const message = envelope?.errorMsg ?? `Couldn't render the preview (${response.status}).`;
        const idx = message.indexOf("\n\n");
        return idx === -1
          ? { ok: false, error: message }
          : { ok: false, error: message.slice(0, idx), logExcerpt: message.slice(idx + 2) };
      }
      return { ok: true, blob: await response.blob() };
    },
  },
  artifacts: {
    /** Direct link to the artifact PDF endpoint — a download button hrefs this
     *  (the response streams `application/pdf` bytes, not an envelope). */
    pdfUrl: (taskId: string, kind: "resume" | "cover-letter") =>
      `/api/v1/agent/tasks/${taskId}/artifacts/${kind}/pdf`,
  },
};
