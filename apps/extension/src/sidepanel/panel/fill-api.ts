import type {
  ApiResult,
  AnswerEntry,
  ApplicationSummary,
  FieldReport,
  FileFetchResult,
  FillTaskBundle,
  FillTicket,
  FitSummary,
  ReportResult,
} from "../../lib/offeros-api";
import type { AiResolution } from "../../lib/autofill/task-mode";

/** The web-app fill API the panel talks to. Injected so tests can supply fakes. */
export interface FillApi {
  getPending: () => Promise<ApiResult<FillTicket[]>>;
  claim: (handoffId: string) => Promise<ApiResult<FillTaskBundle>>;
  postReport: (
    taskId: string,
    reports: FieldReport[],
    complete?: boolean,
    /** The ticket this panel holds, so the server can say whether it is still
     *  the current claimer. */
    handoffId?: string,
  ) => Promise<ApiResult<ReportResult>>;
  postEvidence: (
    applicationId: string,
    body: { label?: string; dataUrl: string },
  ) => Promise<ApiResult<{ file: string; bytes: number }>>;
  generateAnswer: (
    taskId: string,
    body: {
      question: string;
      label: string;
      context?: string;
      options?: string[];
      existingAnswer?: string;
      /** A revision the user typed, sent alongside `existingAnswer`. */
      instruction?: string;
    },
  ) => Promise<ApiResult<{ answer: string }>>;
  /**
   * The AI fallback classifier. Sends descriptions of the fields the
   * deterministic engine could not read; gets back mappings the server has
   * already resolved into values and run the guards over.
   */
  classifyFields: (
    taskId: string,
    fields: {
      fieldId: string;
      label: string;
      type: string;
      options?: string[];
      currentStatus: string;
      required?: boolean;
      contextText?: string;
    }[],
  ) => Promise<ApiResult<{ resolutions: AiResolution[]; considered: number; classified: number }>>;
  /** Store this page's rendered description against the application. */
  saveJdFromPage: (applicationId: string, jdText: string) => Promise<ApiResult<unknown>>;
  findApplicationsByJobUrl: (jobUrl: string) => Promise<ApiResult<ApplicationSummary[]>>;
  createTaskFromJd: (input: {
    jobTitle: string;
    companyName: string;
    jobUrl: string;
    jdText: string;
  }) => Promise<ApiResult<{ id: string; applicationId: string }>>;
  /** One-click instant lane: park a fill-gate task for this page and claim it. */
  instantFill: (input: {
    jobTitle: string;
    companyName: string;
    jobUrl: string;
    jdText: string;
  }) => Promise<ApiResult<FillTaskBundle>>;
  /** In-panel tailor: run the tailor-resume step for the claimed task. */
  tailorResume: (taskId: string) => Promise<ApiResult<unknown>>;
  /** In-panel cover letter: run the cover-letter step for the claimed task. */
  generateCoverLetter: (taskId: string) => Promise<ApiResult<unknown>>;
  /** Stored fit for the claimed application ({ok:false} when never computed). */
  getFit: (applicationId: string) => Promise<ApiResult<FitSummary>>;
  /** Compute/recompute the fit (an LLM call). */
  computeFit: (applicationId: string) => Promise<ApiResult<FitSummary>>;
  /** Terminal fill resolution from the panel ("applied-manually" = mark submitted). */
  resolveFillAction: (
    taskId: string,
    action: "fixed" | "applied-manually",
  ) => Promise<ApiResult<unknown>>;
  /** Undo a mark-as-submitted (mis-click recovery). */
  undoSubmission: (taskId: string) => Promise<ApiResult<unknown>>;
  /** Ledger a self-recovery attempt (best-effort; failures ignored). */
  postRepairEvent: (
    taskId: string,
    kind: "repair-attempted" | "repair-succeeded" | "repair-failed",
    payload: { failure: string; action: string; detail?: string },
  ) => Promise<ApiResult<unknown>>;
  /** Original stored résumé bytes (`bundle.attachResume === "original"`). */
  fetchResumeFile: (resumeId: string) => Promise<FileFetchResult>;
  /** Rendered artifact PDF — the tailored résumé, or the cover letter. */
  fetchArtifactPdf: (taskId: string, kind: "resume" | "cover-letter") => Promise<FileFetchResult>;
  /** Answer memory — accepted AI answers persist here, deduped by normalized question. */
  listAnswers: () => Promise<ApiResult<AnswerEntry[]>>;
  createAnswer: (input: { question: string; answer: string }) => Promise<ApiResult<AnswerEntry>>;
  updateAnswer: (id: string, input: { answer: string }) => Promise<ApiResult<AnswerEntry>>;
}
