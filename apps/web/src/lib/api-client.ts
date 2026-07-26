import type {
  AnswerEntry,
  Application,
  AgentTask,
  ApplicationInfo,
  ApplicationStatus,
  Artifact,
  ArtifactVersion,
  FieldReport,
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
import type { FillTaskBundle } from "@/server/services/fill-service";
import type { LineDiff } from "./diff";

/** An open fill ticket plus the job header the pending list renders. */
export type FillTicket = FillHandoff & {
  job: { title: string; company: string; applyLink?: string };
};

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
    get: () => request<Profile | null>("/profile"),
    save: (profile: Profile) => request<Profile>("/profile", json("PUT", profile)),
    parseResume: (input: { resumeText: string }) =>
      request<ParsedResume>("/profile/parse-resume", json("POST", input)),
  },
  applications: {
    list: () => request<Application[]>("/applications"),
    get: (id: string) => request<Application>(`/applications/${id}`),
    create: (input: { jobInfo: JobInfo; jdText?: string; status?: ApplicationStatus }) =>
      request<Application>("/applications", json("POST", input)),
    update: (
      id: string,
      patch: Partial<{
        status: ApplicationStatus;
        notes: string;
        jdText: string;
        resumeId: string;
        appliedAt: number;
      }>,
    ) => request<Application>(`/applications/${id}`, json("PATCH", patch)),
  },
  agentTasks: {
    list: () => request<AgentTask[]>("/agent/tasks"),
    create: (input: { applicationId: string }) =>
      request<AgentTask>("/agent/tasks", json("POST", input)),
    createFromJd: (input: { jobInfo: JobInfo; jdText?: string; source?: string }) =>
      request<AgentTask>("/agent/tasks", json("POST", input)),
    update: (
      id: string,
      patch: Partial<{
        status: AgentTask["status"];
        step: number;
        applicationInfo: ApplicationInfo;
        resumeId: string;
        coverLetterId: string;
      }>,
    ) => request<AgentTask>(`/agent/tasks/${id}`, json("PATCH", patch)),
    get: (id: string) =>
      request<{ task: AgentTask; jdAnalysis: JdAnalysis | null; artifacts: Artifact[] }>(
        `/agent/tasks/${id}`,
      ),
    start: (id: string) => request<AgentTask>(`/agent/tasks/${id}/start`, json("POST", {})),
    advance: (id: string) => request<AgentTask>(`/agent/tasks/${id}/advance`, json("POST", {})),
    tweak: (id: string, kind: "resume" | "cover-letter", instruction: string) =>
      request<{ version: ArtifactVersion; diff: LineDiff }>(
        `/agent/tasks/${id}/tweak`,
        json("POST", { kind, instruction }),
      ),
    choice: (id: string, choice: "skip" | "generate") =>
      request<AgentTask>(`/agent/tasks/${id}/choice`, json("POST", { choice })),
    pause: (id: string) => request<AgentTask>(`/agent/tasks/${id}/pause`, json("POST", {})),
    fillHandoff: (id: string) =>
      request<FillHandoff>(`/agent/tasks/${id}/fill/handoff`, json("POST", {})),
    fillResolve: (id: string, action: "fixed" | "applied-manually") =>
      request<AgentTask>(`/agent/tasks/${id}/fill/resolve`, json("POST", { action })),
  },
  fill: {
    pending: () => request<FillTicket[]>("/agent/fill/pending"),
    claim: (handoffId: string) =>
      request<FillTaskBundle>(`/agent/fill/handoffs/${handoffId}/claim`, json("POST", {})),
    report: (taskId: string, body: { reports: FieldReport[]; complete?: boolean }) =>
      request<AgentTask>(`/agent/tasks/${taskId}/fill/report`, json("POST", body)),
    answer: (
      taskId: string,
      body: { question: string; label: string; context?: string; existingAnswer?: string },
    ) => request<{ answer: string }>(`/agent/tasks/${taskId}/fill/answer`, json("POST", body)),
  },
  fit: {
    get: (applicationId: string) => request<FitAnalysis>(`/applications/${applicationId}/fit`),
    recompute: (applicationId: string) =>
      request<FitAnalysis>(`/applications/${applicationId}/fit`, json("POST", {})),
  },
  settings: {
    get: () => request<Settings>("/settings"),
    save: (settings: Settings) => request<Settings>("/settings", json("PUT", settings)),
    llmKeys: () => request<Record<string, "saved" | "env" | "none">>("/settings/llm-keys"),
    setLlmKey: (provider: string, key: string) =>
      request<Record<string, "saved" | "env" | "none">>(
        "/settings/llm-keys",
        json("PUT", { provider, key }),
      ),
    testLlm: (input: { provider: string; model?: string; key?: string }) =>
      request<{ ok: true }>("/settings/test-llm", json("POST", input)),
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
