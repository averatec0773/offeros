import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Minus, RefreshCw, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { SectionCard } from "../components/ui/section-card";
import {
  classifiedRatio,
  explainFillPlan,
  fillCoverage,
  normalizeQuestion,
  type Coverage,
  type FieldTrace,
  type FillItem,
} from "@offeros/autofill";
import type { FillValue } from "../lib/autofill/dom-fill";
import { jobIdFromUrl } from "../lib/autofill/recipes";
import { bytesToBase64 } from "../lib/autofill/base64";
import type {
  ScanResponse,
  FillResponse,
  CaptureJdResponse,
  AttachFileResponse,
} from "../lib/autofill/autofill-messaging";
import type {
  AnswerEntry,
  ApiResult,
  ApplicationSummary,
  FieldReport,
  FileFetchResult,
  FillTaskBundle,
  FillTicket,
  FitSummary,
} from "../lib/offeros-api";
import {
  buildFieldReports,
  isCoverLetterField,
  isTextAnswerTarget,
  matchHandoff,
  CUSTOM_UPLOADER_REASON,
  NO_FILE_REASON,
  RENDER_FAILED_REASON,
  type FieldReportSource,
  type WriteOutcome,
} from "../lib/autofill/task-mode";

type OkScan = Extract<ScanResponse, { ok: true }>;

// Status glyphs are lucide icons (canon) — not raw ✓/⚠/–.
// Ready = mint brand, needs-answer = amber, unrecognized = muted.
const STATUS_ICON: Record<FillItem["status"], { Icon: LucideIcon; cls: string }> = {
  fillable: { Icon: Check, cls: "text-brand" },
  "needs-answer": { Icon: TriangleAlert, cls: "text-warning" },
  unknown: { Icon: Minus, cls: "text-text-tertiary" },
};

function StatusIcon({ status, written }: { status: FillItem["status"]; written: boolean }) {
  // Written = the value verifiably landed on the page this session (or a
  // rehydrated report says it did) — a solid brand check, distinct from the
  // outline "ready" check. Rows flip to this live as the fill progresses.
  if (written) {
    return (
      <span
        aria-hidden
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-brand"
      >
        <Check className="h-2.5 w-2.5 text-brand-foreground" strokeWidth={3} />
      </span>
    );
  }
  const { Icon, cls } = STATUS_ICON[status];
  return <Icon aria-hidden className={`h-3.5 w-3.5 shrink-0 ${cls}`} />;
}

/** The web-app fill API the panel talks to. Injected so tests can supply fakes. */
export interface FillApi {
  getPending: () => Promise<ApiResult<FillTicket[]>>;
  claim: (handoffId: string) => Promise<ApiResult<FillTaskBundle>>;
  postReport: (taskId: string, reports: FieldReport[], complete?: boolean) => Promise<ApiResult<unknown>>;
  generateAnswer: (
    taskId: string,
    body: {
      question: string;
      label: string;
      context?: string;
      options?: string[];
      existingAnswer?: string;
    },
  ) => Promise<ApiResult<{ answer: string }>>;
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
  /** Original stored résumé bytes (`bundle.attachResume === "original"`). */
  fetchResumeFile: (resumeId: string) => Promise<FileFetchResult>;
  /** Rendered artifact PDF — the tailored résumé, or the cover letter. */
  fetchArtifactPdf: (taskId: string, kind: "resume" | "cover-letter") => Promise<FileFetchResult>;
  /** Answer memory — accepted AI answers persist here, deduped by normalized question. */
  listAnswers: () => Promise<ApiResult<AnswerEntry[]>>;
  createAnswer: (input: { question: string; answer: string }) => Promise<ApiResult<AnswerEntry>>;
  updateAnswer: (id: string, input: { answer: string }) => Promise<ApiResult<AnswerEntry>>;
}

/** One OfferOS-managed file kind a file input can classify as — the only
 *  kinds the panel ever auto-attaches. Maps to the report source vocabulary. */
/** Voluntary self-identification questions AI must never answer — the user
 *  seeds these once in Profile → Equal Employment and the bank fills them.
 *  Checked against the question AND the option labels: real forms ask
 *  neutral-sounding questions ("Which communities do you belong to?") whose
 *  OPTIONS are the sensitive part (disability / veteran / immigrant …). */
const SENSITIVE_GROUP =
  /gender|race|ethnic|veteran|disab|orientation|lgbt|pronoun|hispanic|latino|transgender|immigrant|refugee|\bage\b/i;

function isSensitiveGroup(label: string, desc: { label?: string; options?: string[] }): boolean {
  if (SENSITIVE_GROUP.test(`${label} ${desc.label ?? ""}`)) return true;
  return (desc.options ?? []).some((o) => SENSITIVE_GROUP.test(o));
}

/** Work-authorization / visa questions: legally-consequential facts only the
 *  user can assert. They fill from the answer bank (set once in Profile →
 *  Equal Employment) — a wrong AI guess here is a misrepresentation, so AI
 *  never touches them and unanswered ones surface as needs-user. */
const TRUTH_REQUIRED_GROUP = /sponsor|authoriz\w* to work|work authoriz|legally (?:able|authorized|eligible)|eligible to work|\bvisa\b/i;

const FILE_KIND_SOURCE: Record<"resume" | "coverLetter", FieldReportSource> = {
  resume: "resume-file",
  coverLetter: "cover-letter-file",
};

/**
 * One-click "Add this job": capture the JD off the active tab, let the user
 * confirm/edit title + company, dedup by job URL, then create the
 * application + task in one call. Only rendered when there's no active fill
 * task for this tab (see the `!bundle` gate at the call site). Owns no state
 * outside itself — the call site keys it on the job identity (`jobKeyRef`,
 * the same signal that drives `resetTaskMode()` on a job change) so
 * navigating the same tab to a different job remounts it fresh instead of
 * leaving a stale "Added"/"Already tracked" card showing forever.
 */
function AddJobCard({
  capture,
  api,
  openApplication,
}: {
  capture: () => Promise<CaptureJdResponse>;
  api: Pick<FillApi, "findApplicationsByJobUrl" | "createTaskFromJd">;
  openApplication: (applicationId: string) => void;
}) {
  const [captured, setCaptured] = useState<CaptureJdResponse | null>(null);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [dedupMatches, setDedupMatches] = useState<ApplicationSummary[] | null>(null);
  const [createdApplicationId, setCreatedApplicationId] = useState<string | null>(null);
  // Guards the mutating create call (both entry points funnel through doCreate) against
  // a double-click firing it twice before the `busy`-driven disabled state re-renders —
  // mirrors the parent panel's pendingRef idiom.
  const pendingRef = useRef(false);

  const onAddThisJob = async () => {
    setBusy(true);
    try {
      const res = await capture();
      setCaptured(res);
      // Prefer the sanitized structured (JSON-LD) fields; fall back to the engine's
      // sanitized page-meta guess (h1/doc title, og:site_name/hostname) rather than
      // leaving the form blank on a DOM-only capture — still just a starting point,
      // the user reviews/edits before Create.
      setTitle(res.structuredTitle ?? res.metaTitle ?? "");
      setCompany(res.structuredCompany ?? res.metaCompany ?? "");
      setDedupMatches(null);
      setCreatedApplicationId(null);
    } finally {
      setBusy(false);
    }
  };

  const doCreate = async () => {
    if (!captured || pendingRef.current) return;
    pendingRef.current = true;
    setBusy(true);
    try {
      const created = await api.createTaskFromJd({
        jobTitle: title.trim(),
        companyName: company.trim(),
        jobUrl: captured.url,
        jdText: captured.jd,
      });
      if (created.ok) setCreatedApplicationId(created.value.applicationId);
    } finally {
      pendingRef.current = false;
      setBusy(false);
    }
  };

  const onCreate = async () => {
    if (!captured) return;
    setBusy(true);
    try {
      const dedup = await api.findApplicationsByJobUrl(captured.url);
      if (dedup.ok && dedup.value.length > 0) {
        setDedupMatches(dedup.value);
        return;
      }
      await doCreate();
    } finally {
      setBusy(false);
    }
  };

  const onCancel = () => {
    setCaptured(null);
    setDedupMatches(null);
    setCreatedApplicationId(null);
  };

  if (createdApplicationId) {
    return (
      <div className="mt-3 rounded-xl bg-bg-base p-3">
        <p className="text-caption text-success">Added — tracked in OfferOS.</p>
        <div className="mt-2 flex gap-2">
          <Button
            variant="primary"
            className="rounded-full"
            onClick={() => openApplication(createdApplicationId)}
          >
            Open in OfferOS
          </Button>
          <Button className="rounded-full" onClick={onCancel}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  if (dedupMatches) {
    return (
      <div className="mt-3 rounded-xl bg-bg-base p-3">
        <p className="text-caption text-text-secondary">Already tracked.</p>
        <div className="mt-2 flex gap-2">
          <Button
            variant="primary"
            className="rounded-full"
            onClick={() => openApplication(dedupMatches[0]!.id)}
          >
            Open existing
          </Button>
          <Button className="rounded-full" disabled={busy} onClick={() => void doCreate()}>
            Create anyway
          </Button>
        </div>
        <Button className="mt-2 rounded-full" onClick={onCancel}>
          Back
        </Button>
      </div>
    );
  }

  if (captured) {
    if (captured.source === "none") {
      return (
        <div className="mt-3 rounded-xl bg-bg-base p-3">
          <p className="text-caption leading-relaxed text-text-secondary">
            Couldn't read a posting here — open the job posting page.
          </p>
          <Button className="mt-2 rounded-full" onClick={onCancel}>
            Close
          </Button>
        </div>
      );
    }
    return (
      <div className="mt-3 space-y-2 rounded-xl bg-bg-base p-3">
        <label className="block text-caption text-text-tertiary">
          Job title
          <input
            className="mt-1 w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-caption text-text-primary focus:outline-none focus:ring-1 focus:ring-brand"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Job title"
          />
        </label>
        <label className="block text-caption text-text-tertiary">
          Company
          <input
            className="mt-1 w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-caption text-text-primary focus:outline-none focus:ring-1 focus:ring-brand"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            aria-label="Company"
          />
        </label>
        <p className="text-micro text-text-tertiary">{captured.jd.length} characters captured</p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            className="rounded-full"
            disabled={busy || title.trim() === "" || company.trim() === ""}
            onClick={() => void onCreate()}
          >
            Create
          </Button>
          <Button className="rounded-full" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button className="mt-2 rounded-full" disabled={busy} onClick={() => void onAddThisJob()}>
      Add this job
    </Button>
  );
}

/** Generate → preview → attach card, shared by the résumé and cover-letter
 *  flows. Pure UI — the caller owns all state and handlers. */
function ArtifactCard({
  title,
  cta,
  busyLabel,
  hint,
  previewTitle,
  attachCta,
  busy,
  error,
  pdf,
  attached,
  onGenerate,
  onAttach,
}: {
  title: string;
  cta: string;
  busyLabel: string;
  hint: string;
  previewTitle: string;
  attachCta: string;
  busy: boolean;
  error: string | null;
  pdf: { url: string; fileName: string } | null;
  attached: boolean;
  onGenerate: () => void;
  onAttach: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl bg-bg-base p-3">
      <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
        {title}
      </p>
      {!pdf ? (
        <>
          <Button variant="primary" className="rounded-full" disabled={busy} onClick={onGenerate}>
            {busy ? busyLabel : cta}
          </Button>
          <p className="mt-1.5 text-caption leading-relaxed text-text-secondary">{hint}</p>
        </>
      ) : (
        <>
          <iframe
            src={pdf.url}
            title={previewTitle}
            className="h-72 w-full rounded-xl border border-border-subtle bg-white"
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="primary"
              className="rounded-full"
              disabled={busy || attached}
              onClick={onAttach}
            >
              {attached ? "Attached" : attachCta}
            </Button>
            <Button className="rounded-full" disabled={busy} onClick={onGenerate}>
              {busy ? busyLabel : "Regenerate"}
            </Button>
          </div>
          {attached && (
            <p className="mt-1.5 text-caption text-success">Attached — review it on the page.</p>
          )}
        </>
      )}
      {error && <p className="mt-1.5 text-caption text-warning">{error}</p>}
    </div>
  );
}

// Submit-readiness bar: required fields we have a value for / total.
function CoverageBar({ coverage }: { coverage: Coverage }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between text-caption">
        <span className="font-medium text-text-primary">
          {coverage.requiredBasis
            ? `${coverage.filled}/${coverage.total} required fields ready`
            : `${coverage.filled}/${coverage.total} fields ready`}
        </span>
        <span className="text-text-tertiary">{coverage.percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-bg-base">
        <div className="h-full rounded-full bg-brand" style={{ width: `${coverage.percent}%` }} />
      </div>
    </div>
  );
}

// Required / Optional checklist group. Each row is clickable — it scrolls the
// page to that field and flashes the highlight — and carries the fill plan's
// per-field reason ("why this value") as its tooltip. An empty group is
// omitted so an ATS that marks nothing required renders no header.
function FieldGroup({
  title,
  items,
  reasonFor,
  onJump,
  writtenValue,
  revealKey,
}: {
  title: string;
  items: FillItem[];
  reasonFor?: (fieldId: string) => string | undefined;
  onJump?: (fieldId: string) => void;
  /** Value verifiably written to the page for this field this session, if any. */
  writtenValue?: (fieldId: string) => string | undefined;
  /** Changes when a NEW page's fields arrive — remounts rows so the staggered
   *  reveal replays for the new form (and never on ordinary re-renders). */
  revealKey?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary">{title}</p>
      <ul className="space-y-0.5 text-body">
        {items.map((i, index) => {
          const written = writtenValue?.(i.fieldId);
          return (
            <li
              key={`${revealKey ?? ""}|${i.fieldId}`}
              className="animate-slide-in-right"
              style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
            >
              <button
                type="button"
                title={reasonFor?.(i.fieldId)}
                data-written={written !== undefined || undefined}
                onClick={() => onJump?.(i.fieldId)}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-bg-base"
              >
                <StatusIcon status={i.status} written={written !== undefined} />
                <span className="flex-1 truncate text-text-primary">{i.label}</span>
                {(written ?? (i.status === "fillable" ? i.value : undefined)) !== undefined && (
                  <span className="truncate text-text-tertiary">
                    {written ?? (i.status === "fillable" ? i.value : "")}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The thin fill panel: drives the active ATS tab's engine over injected scan/fill,
 * and runs OfferOS task mode (claim a handoff → fill → report) over the injected
 * web-app `api`. No Dexie, no standalone LLM — a bundle only ever appears via
 * auto-claim, and every fill/report is gated on holding one.
 */
export function FillPanel({
  scan,
  fill,
  capture,
  attachFile,
  scrollToField,
  api,
  rescanNonce,
  openWebApp,
  openApplication,
  webReachable,
  tabUrl,
  getBoundHandoff,
  scanRetryTries = 16,
  scanRetryDelayMs = 500,
}: {
  scan: () => Promise<ScanResponse>;
  fill: (values: FillValue[]) => Promise<FillResponse>;
  capture: () => Promise<CaptureJdResponse>;
  /** Cross the messaging boundary to attach a fetched file to a file input in
   *  the content-script's DOM (see engine-service.ts's Engine.attachFile). */
  attachFile: (
    fieldId: string,
    file: { fileName: string; mimeType: string; bytesBase64: string },
  ) => Promise<AttachFileResponse>;
  /** Bring a scanned field into view on the page (scroll + highlight flash). */
  scrollToField?: (fieldId: string) => Promise<unknown>;
  /** The handoff explicitly bound to this tab (workspace-opened tabs) — wins
   *  over URL-heuristic ticket matching when present. */
  getBoundHandoff?: () => Promise<string | null>;
  /** Scan-probe retry budget while the content script is still injecting. */
  scanRetryTries?: number;
  scanRetryDelayMs?: number;
  api: FillApi;
  rescanNonce: number;
  openWebApp: () => void;
  openApplication: (applicationId: string) => void;
  webReachable: boolean;
  /** The active tab's URL — used to key AddJobCard on the no-form branch below,
   *  where jobKeyRef is never set (it's only populated by an ok scan). */
  tabUrl: string;
}) {
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [scanTimedOut, setScanTimedOut] = useState(false);
  const [scanNonce, setScanNonce] = useState(0);
  const [plan, setPlan] = useState<FillItem[]>([]);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [filledOnce, setFilledOnce] = useState(false);
  const [bundle, setBundle] = useState<FillTaskBundle | null>(null);
  const [instantBusy, setInstantBusy] = useState(false);
  const [instantError, setInstantError] = useState<string | null>(null);
  const [fit, setFit] = useState<FitSummary | null>(null);
  const [fitBusy, setFitBusy] = useState(false);
  const [fitError, setFitError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<"idle" | "busy" | "done">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tailorBusy, setTailorBusy] = useState(false);
  const [tailorError, setTailorError] = useState<string | null>(null);
  const [tailorPdf, setTailorPdf] = useState<{ url: string; fileName: string } | null>(null);
  const [tailorAttached, setTailorAttached] = useState(false);
  // The fetched PDF bytes behind the current preview (refs so resetTaskMode and
  // the attach handler never race a stale closure), and its blob URL for revoke.
  const tailorFetchedRef = useRef<Extract<FileFetchResult, { ok: true }> | null>(null);
  const tailorUrlRef = useRef<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [coverPdf, setCoverPdf] = useState<{ url: string; fileName: string } | null>(null);
  const [coverAttached, setCoverAttached] = useState(false);
  const coverFetchedRef = useRef<Extract<FileFetchResult, { ok: true }> | null>(null);
  const coverUrlRef = useRef<string | null>(null);
  const [fitExpanded, setFitExpanded] = useState(false);
  // fieldId → the value that verifiably landed on the page. Updated live as
  // each fill phase completes (batch → cover letter → per-question AI →
  // attaches), so rows flip to their solid check one by one, each flip
  // backed by a verified DOM write.
  const [writtenFields, setWrittenFields] = useState<Map<string, string>>(new Map());
  const markWritten = (fieldId: string, value: string) =>
    setWrittenFields((prev) => new Map(prev).set(fieldId, value));
  const [aiAnswers, setAiAnswers] = useState<
    { fieldId: string; label: string; answer: string; options?: string[] }[]
  >([]);
  const [reported, setReported] = useState(false);
  // fieldIds whose current AI answer text has been accepted + persisted to the answer
  // bank — drives the "Saved to your answers." caption. Cleared on edit/regenerate so
  // the caption never claims an unsaved edit was saved.
  const [savedFieldIds, setSavedFieldIds] = useState<Set<string>>(new Set());

  const pendingRef = useRef(false);
  const pageSigRef = useRef<string | null>(null);
  const jobKeyRef = useRef<string | null>(null);
  const bundleRef = useRef<FillTaskBundle | null>(null);
  const traceRef = useRef<FieldTrace[]>([]);
  const claimTriedRef = useRef(false);
  const lastRescanNonceRef = useRef(rescanNonce);
  // Field reports accumulate across wizard pages, keyed by (page ?? "") + fieldId, re-sent cumulatively.
  const reportsRef = useRef<Map<string, FieldReport>>(new Map());
  const reportKey = (r: FieldReport) => `${r.page ?? ""} ${r.fieldId}`;
  const accumulateReports = (reports: FieldReport[]) => {
    for (const r of reports) reportsRef.current.set(reportKey(r), r);
  };
  const allReports = () => Array.from(reportsRef.current.values());
  const resetTailor = () => {
    if (tailorUrlRef.current) URL.revokeObjectURL(tailorUrlRef.current);
    tailorUrlRef.current = null;
    tailorFetchedRef.current = null;
    setTailorPdf(null);
    setTailorError(null);
    setTailorBusy(false);
    setTailorAttached(false);
    if (coverUrlRef.current) URL.revokeObjectURL(coverUrlRef.current);
    coverUrlRef.current = null;
    coverFetchedRef.current = null;
    setCoverPdf(null);
    setCoverError(null);
    setCoverBusy(false);
    setCoverAttached(false);
    setFitExpanded(false);
  };

  // A bundle can arrive carrying an earlier session's per-field reports (the
  // panel or the whole extension reloaded mid-fill and re-claimed the same
  // ticket) — rehydrate the cumulative report so Done and the workspace view
  // continue where the previous session stopped.
  const hydrateFromBundle = (b: FillTaskBundle) => {
    reportsRef.current.clear();
    let anyFilled = false;
    for (const r of b.fieldReports ?? []) {
      reportsRef.current.set(reportKey(r), r);
      if (r.outcome === "filled") anyFilled = true;
    }
    // Written rows are NOT painted from here — rehydrated reports only light a
    // row up when their page signature matches the current scan (see
    // writtenValueFor), so a report from an earlier page layout (or the old
    // session-counter id era) can never decorate the wrong field.
    if (anyFilled) setFilledOnce(true);
  };

  // fieldId → the control's DOM value at the latest scan. Gates rehydrated
  // checkmarks: a report may say "filled" from an earlier session, but if the
  // page reloaded since, the value is gone — showing the check would claim
  // the page holds a value it doesn't, exactly the state that reads as
  // "OfferOS can't fill this".
  const pageValuesRef = useRef<Map<string, string>>(new Map());

  // Live writes first; else a rehydrated report for THIS page signature —
  // honored only while the field still holds a value on the page.
  const writtenValueFor = (fieldId: string): string | undefined => {
    const live = writtenFields.get(fieldId);
    if (live !== undefined) return live;
    const hydrated = reportsRef.current.get(`${pageSigRef.current ?? ""} ${fieldId}`);
    if (hydrated?.outcome !== "filled") return undefined;
    if ((pageValuesRef.current.get(fieldId) ?? "") === "") return undefined;
    return hydrated.value ?? "";
  };
  const resetTaskMode = () => {
    bundleRef.current = null;
    setBundle(null);
    reportsRef.current.clear();
    setAiAnswers([]);
    setSavedFieldIds(new Set());
    setReported(false);
    setFilledOnce(false);
    setInstantError(null);
    setWrittenFields(new Map());
    setFit(null);
    setFitBusy(false);
    setFitError(null);
    setSubmitState("idle");
    setSubmitError(null);
    resetTailor();
    claimTriedRef.current = false;
  };

  // Fit signal: whenever a bundle is claimed, show the stored fit if one
  // exists. A miss (never computed, or web hiccup) just leaves the on-demand
  // "Analyze fit" entry — never an error state on its own.
  const claimedApplicationId = bundle?.applicationId ?? null;
  useEffect(() => {
    if (!claimedApplicationId) return;
    let live = true;
    void api.getFit(claimedApplicationId).then((res) => {
      if (live && res.ok) setFit(res.value);
    });
    return () => {
      live = false;
    };
  }, [api, claimedApplicationId]);

  const onAnalyzeFit = async () => {
    const b = bundleRef.current;
    if (!b || fitBusy) return;
    setFitBusy(true);
    setFitError(null);
    try {
      const res = await api.computeFit(b.applicationId);
      if (res.ok) setFit(res.value);
      else setFitError(res.error);
    } finally {
      setFitBusy(false);
    }
  };

  // Terminal resolution from the panel: the user states they submitted the
  // application themselves. Valid whenever the task sits at the fill or
  // submit gate — exactly where a reported fill leaves it.
  const onMarkApplied = async () => {
    const b = bundleRef.current;
    if (!b || submitState !== "idle") return;
    setSubmitState("busy");
    setSubmitError(null);
    const res = await api.resolveFillAction(b.taskId, "applied-manually");
    if (res.ok) {
      setSubmitState("done");
    } else {
      setSubmitState("idle");
      setSubmitError(res.error);
    }
  };

  // Write one value and report whether the DOM actually took it. An absent outcome
  // (file input, element gone) must never be treated as a successful write.
  const writeOne = async (fieldId: string, value: string): Promise<boolean> => {
    const r = await fill([{ fieldId, value }]);
    return r.outcomes?.some(([id, o]) => id === fieldId && o === "filled") ?? false;
  };

  // Fetch bytes for one OfferOS-managed file kind, then drive the content-script
  // attach + DOM verify over the messaging boundary. A 404 (nothing stored, or a
  // stale attachResume preference), a 400 (the artifact exists but failed to
  // render), and a failed DOM verify all fall back to an honest needs-user
  // reason — never a crash, never a false "filled".
  const attachManagedFile = async (
    fieldId: string,
    fetched: FileFetchResult,
    kind: "resume" | "coverLetter",
  ): Promise<WriteOutcome> => {
    const source = FILE_KIND_SOURCE[kind];
    if (!fetched.ok) {
      const reason = fetched.status === 400 ? RENDER_FAILED_REASON : NO_FILE_REASON;
      return { outcome: "needs-user", reason, source };
    }
    // The content-script call crosses the messaging boundary (tabs.sendMessage) —
    // a torn-down/invalidated extension context can reject it outright. Caught here
    // so that failure degrades to the same honest custom-uploader reason instead of
    // throwing out of taskFillPage and killing the rest of the page's cumulative report.
    let res: AttachFileResponse;
    try {
      res = await attachFile(fieldId, {
        fileName: fetched.fileName,
        mimeType: fetched.mimeType,
        bytesBase64: bytesToBase64(fetched.bytes),
      });
    } catch {
      return { outcome: "needs-user", reason: CUSTOM_UPLOADER_REASON, source };
    }
    if (res.ok) {
      return { outcome: "filled", value: fetched.fileName, source };
    }
    return { outcome: "needs-user", reason: CUSTOM_UPLOADER_REASON, source };
  };

  // Task-mode fill for one (wizard) page: classified/personal fields from the bundle
  // profile, cover-letter textareas verbatim, AI answers for open-ended free-text,
  // résumé/cover-letter file attaches, then a cumulative FieldReport back to the
  // workspace. Any other (unrecognized) file input is still never touched.
  const taskFillPage = async (planForFill: FillItem[], sr: OkScan, traceForFill: FieldTrace[]) => {
    const b = bundleRef.current;
    if (!b || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const writes = new Map<string, WriteOutcome>();
      const descriptorById = new Map(sr.descriptors.map((d) => [d.fieldId, d]));
      const isTextTarget = (fieldId: string) => {
        const desc = descriptorById.get(fieldId);
        return desc ? isTextAnswerTarget(desc) : false;
      };

      // 1) classified / answer-bank / skills fields the engine already resolved.
      const fillable = planForFill.filter((i) => i.status === "fillable");
      const res = await fill(
        fillable.map((i) =>
          i.values ? { fieldId: i.fieldId, values: i.values } : { fieldId: i.fieldId, value: i.value },
        ),
      );
      const valueById = new Map(fillable.map((i) => [i.fieldId, i.value ?? i.values?.join(", ") ?? ""]));
      for (const [id, o] of res.outcomes ?? []) {
        writes.set(id, o);
        if (o === "filled") markWritten(id, valueById.get(id) ?? "");
      }

      // 2) cover-letter textareas ← bundle.coverLetterText verbatim (never generated).
      const coverText = b.coverLetterText?.trim() ? b.coverLetterText : null;
      if (coverText) {
        for (const cf of planForFill.filter(
          (i) => i.status === "needs-answer" && isCoverLetterField(i.label) && isTextTarget(i.fieldId),
        )) {
          if (await writeOne(cf.fieldId, coverText)) {
            writes.set(cf.fieldId, { outcome: "filled", value: coverText, source: "cover-letter" });
            markWritten(cf.fieldId, "Cover letter");
          }
          // a failed cover-letter write stays unreported here → needs-user.
        }
      }

      // 3) open-ended free-text → AI answer → fill. Generation or write failure leaves
      // the field unwritten so it reports as needs-user (a human must answer).
      const collected: { fieldId: string; label: string; answer: string; options?: string[] }[] =
        [];
      for (const q of planForFill.filter(
        (i) =>
          i.status === "needs-answer" &&
          i.generatable === true &&
          !isCoverLetterField(i.label) &&
          isTextTarget(i.fieldId),
      )) {
        const ans = await api.generateAnswer(b.taskId, {
          question: q.label,
          label: q.label,
          context: b.jdSummary ?? undefined,
        });
        if (!ans.ok) continue;
        if (await writeOne(q.fieldId, ans.value.answer)) {
          writes.set(q.fieldId, { outcome: "filled", value: ans.value.answer, source: "ai-generated" });
          markWritten(q.fieldId, ans.value.answer);
          collected.push({ fieldId: q.fieldId, label: q.label, answer: ans.value.answer });
        }
      }
      // 3b) multiple-choice groups the bank couldn't answer → AI picks exactly
      // one of the page's own options. Required groups first, then optional
      // ones (owner call: optional questions are worth answering too — every
      // AI pick stays visible and editable in the panel). Voluntary
      // self-identification questions (gender/race/veteran/…) are deliberately
      // excluded — those are answered once from Profile → Equal Employment,
      // never guessed by AI. An off-list AI answer simply fails the group's
      // option-click verify and the field stays needs-user.
      const aiAnswerableGroup = (i: FillItem) => {
        const desc = descriptorById.get(i.fieldId);
        return (
          i.status === "needs-answer" &&
          desc != null &&
          (desc.type === "radio-group" || desc.type === "checkbox-group") &&
          (desc.options?.length ?? 0) > 0 &&
          !isSensitiveGroup(i.label, desc) &&
          !TRUTH_REQUIRED_GROUP.test(`${i.label} ${desc.label ?? ""}`)
        );
      };
      const groupsToAnswer = [
        ...planForFill.filter((i) => aiAnswerableGroup(i) && i.required),
        ...planForFill.filter((i) => aiAnswerableGroup(i) && !i.required),
      ];
      for (const g of groupsToAnswer) {
        const options = descriptorById.get(g.fieldId)!.options!;
        const ans = await api.generateAnswer(b.taskId, {
          question: g.label,
          label: g.label,
          context: b.jdSummary ?? undefined,
          options,
        });
        if (!ans.ok) continue;
        if (await writeOne(g.fieldId, ans.value.answer)) {
          writes.set(g.fieldId, { outcome: "filled", value: ans.value.answer, source: "ai-generated" });
          markWritten(g.fieldId, ans.value.answer);
          collected.push({ fieldId: g.fieldId, label: g.label, answer: ans.value.answer, options });
        }
      }
      if (collected.length > 0) {
        setAiAnswers((prev) => [...prev.filter((e) => !collected.some((c) => c.fieldId === e.fieldId)), ...collected]);
      }

      // 4) résumé / cover-letter file attach — only the file inputs the classifier
      // recognized as one of the two OfferOS-managed kinds; cover-letter only
      // when the bundle actually carries a confirmed cover letter.
      for (const t of traceForFill) {
        if (t.status !== "needs-answer") continue;
        const desc = descriptorById.get(t.fieldId);
        if (!desc || desc.type !== "file") continue;

        if (t.classifiedType === "resume") {
          const fetched =
            b.attachResume === "original"
              ? b.resumeId
                ? await api.fetchResumeFile(b.resumeId)
                : ({ ok: false } as const)
              : await api.fetchArtifactPdf(b.taskId, "resume");
          const outcome = await attachManagedFile(t.fieldId, fetched, "resume");
          writes.set(t.fieldId, outcome);
          if (typeof outcome !== "string" && outcome.outcome === "filled")
            markWritten(t.fieldId, outcome.value ?? "");
        } else if (t.classifiedType === "coverLetter" && coverText) {
          const fetched = await api.fetchArtifactPdf(b.taskId, "cover-letter");
          const outcome = await attachManagedFile(t.fieldId, fetched, "coverLetter");
          writes.set(t.fieldId, outcome);
          if (typeof outcome !== "string" && outcome.outcome === "filled")
            markWritten(t.fieldId, outcome.value ?? "");
        }
      }

      // 5) build + accumulate + send the cumulative report for this page.
      const page = pageSigRef.current ?? sr.url;
      const requiredIds = new Set(planForFill.filter((i) => i.required).map((i) => i.fieldId));
      accumulateReports(buildFieldReports(traceForFill, writes, requiredIds, page));
      await api.postReport(b.taskId, allReports(), false);

      setFilledOnce(true);
      setDone(true);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  // Regenerate one AI answer: re-ask with the current answer as context, rewrite the
  // field, and re-send the report so the workspace sees the new value.
  const regenerateAnswer = async (entry: {
    fieldId: string;
    label: string;
    answer: string;
    options?: string[];
  }) => {
    const b = bundleRef.current;
    if (!b) return;
    const ans = await api.generateAnswer(b.taskId, {
      question: entry.label,
      label: entry.label,
      context: b.jdSummary ?? undefined,
      options: entry.options,
      existingAnswer: entry.answer,
    });
    if (!ans.ok || !(await writeOne(entry.fieldId, ans.value.answer))) return;
    const answer = ans.value.answer;
    markWritten(entry.fieldId, answer);
    setAiAnswers((prev) => prev.map((e) => (e.fieldId === entry.fieldId ? { ...e, answer } : e)));
    setSavedFieldIds((prev) => {
      if (!prev.has(entry.fieldId)) return prev;
      const next = new Set(prev);
      next.delete(entry.fieldId);
      return next;
    });
    for (const [k, r] of reportsRef.current) {
      if (r.fieldId === entry.fieldId) {
        reportsRef.current.set(k, { ...r, value: answer, outcome: "filled", source: "ai-generated" });
      }
    }
    await api.postReport(b.taskId, allReports(), false);
  };

  // Accept the (possibly user-edited) AI answer text in the panel: write it into the
  // page field, then persist it to the answer bank so future applications reuse it
  // (answer-match prefers bank entries during fill). Dedup by normalized question —
  // an existing entry whose question-pattern normalizes the same way gets overwritten
  // instead of duplicated. Bank-save failures silent-degrade: no caption, no crash —
  // bookkeeping must never break the fill flow.
  const acceptAnswer = async (entry: { fieldId: string; label: string; answer: string }) => {
    const b = bundleRef.current;
    if (!b || entry.answer.trim() === "") return;
    if (await writeOne(entry.fieldId, entry.answer)) {
      markWritten(entry.fieldId, entry.answer);
      for (const [k, r] of reportsRef.current) {
        if (r.fieldId === entry.fieldId) {
          reportsRef.current.set(k, { ...r, value: entry.answer, outcome: "filled", source: "ai-generated" });
        }
      }
      await api.postReport(b.taskId, allReports(), false);
    }
    // Intentional fallthrough: the bank save below runs even when the DOM write just
    // failed. The accepted text is worth keeping in the answer bank for a future
    // application even if this particular page rejected the write.
    const list = await api.listAnswers();
    if (!list.ok) return;
    const normalized = normalizeQuestion(entry.label);
    const match = list.value.find((a) => a.questionPatterns.some((p) => normalizeQuestion(p) === normalized));
    // Update is answer-only: the entry was already matched by an existing pattern, so
    // never send `questionPatterns` here — the web repo's PUT merges via object spread
    // and would clobber every other pattern a curated multi-pattern entry carries.
    const saved = match
      ? await api.updateAnswer(match.id, { answer: entry.answer })
      : await api.createAnswer({ question: entry.label, answer: entry.answer });
    if (!saved.ok) return;
    setSavedFieldIds((prev) => new Set(prev).add(entry.fieldId));
  };

  const onDone = async () => {
    const b = bundleRef.current;
    if (!b) return;
    await api.postReport(b.taskId, allReports(), true);
    setReported(true);
  };

  useEffect(() => {
    let live = true;
    // A forced rescan (a page change, or the web app reconnecting via App's Retry)
    // re-opens the one-per-job claim attempt: the handoff may have appeared since
    // the last scan. The `bundleRef.current === null` gate still blocks double-claim.
    if (rescanNonce !== lastRescanNonceRef.current) {
      lastRescanNonceRef.current = rescanNonce;
      claimTriedRef.current = false;
    }
    // Keep the last ok result on screen during a rescan so a page flip doesn't flash the placeholder.
    setScanResult((prev) => (prev?.ok ? prev : null));
    setScanTimedOut(false);
    const handleScan = (res: ScanResponse) => {
      setScanResult(res);
      if (!res.ok) return;
      // Plan against the claimed bundle's profile; before a claim there is no profile,
      // so everything reads as needs-answer/unknown until a bundle arrives.
      const { plan: newPlan, trace: newTrace } = explainFillPlan(res.descriptors, bundleRef.current?.fillProfile ?? null);
      setPlan(newPlan);
      traceRef.current = newTrace;
      pageValuesRef.current = new Map(res.descriptors.map((d) => [d.fieldId, d.currentValue ?? ""]));

      const pageSig = res.descriptors.map((d) => d.fieldId).join("|");
      // Wizard steps retitle the page, so the ATS job id is the identity when present.
      const jobId = jobIdFromUrl(res.url);
      const jobKey = jobId ? `${res.company}|${jobId}` : `${res.company}|${res.title}`;
      const prevPageSig = pageSigRef.current;
      const prevJobKey = jobKeyRef.current;
      const jobChanged = prevJobKey !== null && jobKey !== prevJobKey;
      const pageChanged = prevPageSig !== null && pageSig !== prevPageSig;
      pageSigRef.current = pageSig;
      jobKeyRef.current = jobKey;

      if (jobChanged) {
        setDone(false);
        resetTaskMode();
      } else if (pageChanged) {
        setDone(false);
      }

      // Auto-claim: one attempt per job while no bundle is held. An explicit
      // tab binding (the workspace opened this tab for a specific handoff)
      // wins outright — the task follows the TAB, so redirects or the user
      // navigating from a careers directory to the real posting never break
      // it. Only unbound tabs fall back to the URL-heuristic match. Any
      // failure is a silent no-op → panel stays in the "no task" state.
      if (bundleRef.current === null && !claimTriedRef.current) {
        claimTriedRef.current = true;
        void (async () => {
          try {
            const bound = (await getBoundHandoff?.()) ?? null;
            let target = bound;
            if (!target) {
              const pend = await api.getPending();
              if (!live || !pend.ok || pend.value.length === 0) return;
              target = matchHandoff(pend.value, res.url, jobIdFromUrl)?.id ?? null;
            }
            if (!target) return;
            const claimed = await api.claim(target);
            if (!live || !claimed.ok) return;
            bundleRef.current = claimed.value;
            setBundle(claimed.value);
            hydrateFromBundle(claimed.value);
            setScanNonce((n) => n + 1);
          } catch {
            // Web app unreachable / extension context invalidated → stay in "no task".
          }
        })();
      }
    };
    // The content script registers its listener at document_end, but the panel
    // can probe earlier (tab switch mid-load, page refresh) — tabs.sendMessage
    // then rejects with "no receiving end". Retry briefly instead of hanging
    // on the placeholder; when the budget runs out, say so readably.
    const attemptScan = (triesLeft: number) => {
      scan()
        .then((res) => {
          if (live) handleScan(res);
        })
        .catch(() => {
          if (!live) return;
          if (triesLeft > 0) {
            setTimeout(() => attemptScan(triesLeft - 1), scanRetryDelayMs);
          } else {
            // Budget spent: say so, but never go dead — keep a slow heartbeat
            // probe so a page that eventually loads still connects (the
            // tab-complete listener in App also restarts a full-budget cycle).
            setScanTimedOut(true);
            setTimeout(() => attemptScan(0), scanRetryDelayMs * 6);
          }
        });
    };
    attemptScan(scanRetryTries);
    return () => {
      live = false;
    };
  }, [scan, rescanNonce, scanNonce, scanRetryTries, scanRetryDelayMs]);

  if (scanResult === null) {
    if (scanTimedOut) {
      return (
        <div className="rounded-2xl border border-border-subtle bg-bg-elevated p-4">
          <p className="text-body font-semibold text-text-primary">Can't reach this page yet</p>
          <p className="mt-1 text-caption leading-relaxed text-text-secondary">
            Still trying — if this persists, reload the tab.
          </p>
        </div>
      );
    }
    // Skeleton mirrors the card that will replace it — the panel reads as
    // "loading a form" instead of a bare sentence while the content script
    // finishes injecting on heavy pages.
    return (
      <div className="rounded-2xl border border-border-subtle bg-bg-elevated p-4" data-testid="scan-skeleton">
        <div className="h-4 w-2/3 animate-pulse rounded bg-bg-base" />
        <div className="mt-2.5 h-3 w-1/2 animate-pulse rounded bg-bg-base" />
        <div className="mt-4 h-9 w-full animate-pulse rounded-full bg-bg-base" />
        <div className="mt-3 h-3 w-full animate-pulse rounded bg-bg-base" />
        <div className="mt-1.5 h-3 w-5/6 animate-pulse rounded bg-bg-base" />
        <p className="mt-3 text-caption text-text-tertiary">Scanning this page…</p>
      </div>
    );
  }

  if (!scanResult.ok) {
    const noForm = scanResult.reason === "no_form";
    return (
      <div className="rounded-2xl border border-border-subtle bg-bg-elevated p-4">
        <p className="text-body font-semibold text-text-primary">
          {noForm ? "No form detected" : "Not an application form"}
        </p>
        <p className="mt-1 text-caption leading-relaxed text-text-secondary">
          {noForm
            ? "Open the application step of this job to fill it."
            : "This page isn't a supported application form."}
        </p>
        {/* A posting page with no form yet (Lever/Ashby/Workday before the applicant
            clicks Apply) still has a JD to capture — Add-this-job only needs that, not
            a form. jobKeyRef is never set here (only an ok scan sets it), so key on the
            tab URL directly. */}
        {noForm && !bundle && webReachable && (
          <AddJobCard key={tabUrl || "no-job"} capture={capture} api={api} openApplication={openApplication} />
        )}
      </div>
    );
  }

  const fillable = plan.filter((i) => i.status === "fillable");
  const needs = plan.filter((i) => i.status === "needs-answer").length;
  const unknown = plan.filter((i) => i.status === "unknown").length;
  const drift = plan.length > 0 && classifiedRatio(plan) < 0.3;

  // Panel row → page glue. traceRef is written together with `plan`, so at
  // render time the reasons match the rows being shown.
  const reasonFor = (fieldId: string) =>
    traceRef.current.find((t) => t.fieldId === fieldId)?.reason || undefined;
  const jumpToField = (fieldId: string) => {
    void scrollToField?.(fieldId)?.catch?.(() => {});
  };

  const onFill = async () => {
    if (pendingRef.current || done || !scanResult.ok || !bundleRef.current) return;
    await taskFillPage(plan, scanResult, traceRef.current);
  };

  // In-panel tailor: run the tailor step on the claimed task (long LLM call),
  // then fetch the rendered PDF for an inline preview. Attaching is a separate,
  // user-gated click below. Regenerate re-runs the step (a new artifact
  // version) and replaces the preview.
  const onTailor = async () => {
    const b = bundleRef.current;
    if (!b || tailorBusy) return;
    setTailorBusy(true);
    setTailorError(null);
    try {
      const res = await api.tailorResume(b.taskId);
      if (!res.ok) {
        setTailorError(res.error);
        return;
      }
      const fetched = await api.fetchArtifactPdf(b.taskId, "resume");
      if (!fetched.ok) {
        setTailorError("Tailored, but the PDF couldn't be rendered — check the artifact in OfferOS.");
        return;
      }
      if (tailorUrlRef.current) URL.revokeObjectURL(tailorUrlRef.current);
      tailorFetchedRef.current = fetched;
      const url = URL.createObjectURL(new Blob([fetched.bytes], { type: fetched.mimeType }));
      tailorUrlRef.current = url;
      setTailorPdf({ url, fileName: fetched.fileName });
      setTailorAttached(false);
      // Future page fills (wizard steps, re-fill) should attach the tailored
      // PDF now that one exists.
      const next: FillTaskBundle = { ...b, attachResume: "tailored" };
      bundleRef.current = next;
      setBundle(next);
    } finally {
      setTailorBusy(false);
    }
  };

  // Attach the previewed tailored PDF to this page's résumé file input,
  // reusing the verified attach path, then reflect it in the cumulative report.
  const onAttachTailored = async () => {
    const b = bundleRef.current;
    const fetched = tailorFetchedRef.current;
    if (!b || !fetched || pendingRef.current) return;
    const resumeField = scanResult?.ok
      ? scanResult.descriptors.find(
          (d) =>
            d.type === "file" &&
            traceRef.current.find((t) => t.fieldId === d.fieldId)?.classifiedType === "resume",
        )
      : undefined;
    if (!resumeField) {
      setTailorError("No résumé upload field on this page — attach the file manually.");
      return;
    }
    setTailorBusy(true);
    setTailorError(null);
    try {
      const outcome = await attachManagedFile(resumeField.fieldId, fetched, "resume");
      const normalized = typeof outcome === "string" ? { outcome } : outcome;
      if (normalized.outcome !== "filled") {
        setTailorError(normalized.reason ?? CUSTOM_UPLOADER_REASON);
        return;
      }
      setTailorAttached(true);
      markWritten(resumeField.fieldId, fetched.fileName);
      for (const [k, r] of reportsRef.current) {
        if (r.fieldId === resumeField.fieldId) {
          reportsRef.current.set(k, {
            ...r,
            outcome: "filled",
            value: fetched.fileName,
            source: "resume-file",
          });
        }
      }
      if (reportsRef.current.size > 0) await api.postReport(b.taskId, allReports(), false);
    } finally {
      setTailorBusy(false);
    }
  };

  // In-panel cover letter: same shape as onTailor — run the step, fetch the
  // rendered PDF, preview; attach stays a separate user-gated click.
  const onCoverGen = async () => {
    const b = bundleRef.current;
    if (!b || coverBusy) return;
    setCoverBusy(true);
    setCoverError(null);
    try {
      const res = await api.generateCoverLetter(b.taskId);
      if (!res.ok) {
        setCoverError(res.error);
        return;
      }
      const fetched = await api.fetchArtifactPdf(b.taskId, "cover-letter");
      if (!fetched.ok) {
        setCoverError("Written, but the PDF couldn't be rendered — check the artifact in OfferOS.");
        return;
      }
      if (coverUrlRef.current) URL.revokeObjectURL(coverUrlRef.current);
      coverFetchedRef.current = fetched;
      const url = URL.createObjectURL(new Blob([fetched.bytes], { type: fetched.mimeType }));
      coverUrlRef.current = url;
      setCoverPdf({ url, fileName: fetched.fileName });
      setCoverAttached(false);
    } finally {
      setCoverBusy(false);
    }
  };

  const onAttachCover = async () => {
    const b = bundleRef.current;
    const fetched = coverFetchedRef.current;
    if (!b || !fetched || pendingRef.current) return;
    const coverField = scanResult?.ok
      ? scanResult.descriptors.find(
          (d) =>
            d.type === "file" &&
            traceRef.current.find((t) => t.fieldId === d.fieldId)?.classifiedType === "coverLetter",
        )
      : undefined;
    if (!coverField) {
      setCoverError("No cover-letter upload field on this page — attach the file manually.");
      return;
    }
    setCoverBusy(true);
    setCoverError(null);
    try {
      const outcome = await attachManagedFile(coverField.fieldId, fetched, "coverLetter");
      const normalized = typeof outcome === "string" ? { outcome } : outcome;
      if (normalized.outcome !== "filled") {
        setCoverError(normalized.reason ?? CUSTOM_UPLOADER_REASON);
        return;
      }
      setCoverAttached(true);
      markWritten(coverField.fieldId, fetched.fileName);
      for (const [k, r] of reportsRef.current) {
        if (r.fieldId === coverField.fieldId) {
          reportsRef.current.set(k, {
            ...r,
            outcome: "filled",
            value: fetched.fileName,
            source: "cover-letter-file",
          });
        }
      }
      if (reportsRef.current.size > 0) await api.postReport(b.taskId, allReports(), false);
    } finally {
      setCoverBusy(false);
    }
  };

  // The instant lane: capture this page's JD, ask the web app to park + claim
  // a fill-gate task for it in one call, then fill immediately with the claimed
  // bundle's profile. From here on the ordinary task-mode flow owns everything
  // (cumulative reports, AI answers, Done). A refused claim (mid-pipeline
  // application, no URL) surfaces as a caption next to the button.
  const onInstantFill = async () => {
    if (pendingRef.current || instantBusy || bundleRef.current !== null || !scanResult.ok) return;
    setInstantBusy(true);
    setInstantError(null);
    try {
      let cap: CaptureJdResponse;
      try {
        cap = await capture();
      } catch {
        setInstantError("Couldn't read this page — reload it and try again.");
        return;
      }
      const claimed = await api.instantFill({
        jobTitle: cap.structuredTitle || cap.metaTitle || scanResult.title,
        companyName: cap.structuredCompany || cap.metaCompany || scanResult.company,
        jobUrl: cap.url,
        jdText: cap.jd,
      });
      if (!claimed.ok) {
        setInstantError(claimed.error);
        return;
      }
      bundleRef.current = claimed.value;
      setBundle(claimed.value);
      hydrateFromBundle(claimed.value);
      const { plan: newPlan, trace: newTrace } = explainFillPlan(
        scanResult.descriptors,
        claimed.value.fillProfile,
      );
      setPlan(newPlan);
      traceRef.current = newTrace;
      await taskFillPage(newPlan, scanResult, newTrace);
    } finally {
      setInstantBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {bundle && (
        <div className="flex items-center gap-2 rounded-full border border-border-subtle bg-bg-elevated px-3 py-1.5">
          <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-brand" />
          <span className="min-w-0 flex-1 truncate text-caption font-semibold text-text-primary">
            {bundle.job.title} · {bundle.job.company}
          </span>
          <span className="shrink-0 text-micro font-semibold uppercase tracking-wide text-text-tertiary">Task</span>
        </div>
      )}
      {bundle && webReachable && (
        <div className="rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-2">
          {fit ? (
            <>
              <button
                type="button"
                onClick={() => setFitExpanded((v) => !v)}
                aria-expanded={fitExpanded}
                className="flex w-full items-center gap-3 text-left"
              >
                <span className="shrink-0 text-title font-semibold tabular-nums text-text-primary">
                  {Math.round(fit.overall)}%
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-caption font-semibold text-text-primary">
                    {fit.label || "Fit"}
                  </p>
                  {!fitExpanded && fit.notAlignedSkills.length > 0 && (
                    <p className="truncate text-caption text-text-secondary">
                      Gaps: {fit.notAlignedSkills.slice(0, 2).map((s) => s.skill).join(" · ")}
                    </p>
                  )}
                </div>
                <ChevronDown
                  aria-hidden
                  className={`h-4 w-4 shrink-0 text-text-tertiary transition-transform duration-fast ${
                    fitExpanded ? "rotate-180" : ""
                  }`}
                />
              </button>
              {fitExpanded && (
                <div className="mt-2 space-y-2 border-t border-border-subtle pt-2">
                  {fit.whyMatch && (
                    <p className="text-caption leading-relaxed text-text-secondary">{fit.whyMatch}</p>
                  )}
                  <p className="text-micro text-text-tertiary">
                    Experience {Math.round(fit.subScores.experience)}% · Skills{" "}
                    {Math.round(fit.subScores.skills)}% · Education{" "}
                    {Math.round(fit.subScores.education)}%
                  </p>
                  {fit.notAlignedSkills.map((s) => (
                    <p key={s.skill} className="text-caption leading-relaxed text-text-secondary">
                      <span className="font-medium text-text-primary">{s.skill}</span>
                      {s.advice ? ` — ${s.advice}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 text-caption text-text-secondary">
                Fit for this job not analyzed yet.
              </span>
              <Button
                className="shrink-0 rounded-full"
                disabled={fitBusy}
                onClick={() => void onAnalyzeFit()}
              >
                {fitBusy ? "Analyzing…" : "Analyze fit"}
              </Button>
            </div>
          )}
          {fitError && <p className="mt-1.5 text-caption text-warning">{fitError}</p>}
        </div>
      )}
      <SectionCard title={`${scanResult.company} · ${scanResult.title}`}>
        <p className="mb-2 text-caption text-text-tertiary">
          {fillable.length} ready · {needs} unanswered · {unknown} unrecognized
        </p>
        {bundle ? (
          <Button
            variant="primary"
            className="mb-3 w-full rounded-full py-2.5 text-body font-semibold"
            disabled={fillable.length === 0 || pending || done}
            onClick={() => void onFill()}
          >
            {`Fill ${fillable.length} ${fillable.length === 1 ? "field" : "fields"}`}
          </Button>
        ) : webReachable ? (
          <div className="mb-3 rounded-xl bg-bg-base p-3">
            <Button
              variant="primary"
              className="w-full rounded-full py-2.5 text-body font-semibold"
              disabled={instantBusy || pending}
              onClick={() => void onInstantFill()}
            >
              {instantBusy ? "Starting…" : "Fill this page with my profile"}
            </Button>
            {instantError && <p className="mt-2 text-caption text-warning">{instantError}</p>}
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-micro text-text-tertiary">
                Fills from your profile · tracked in OfferOS
              </span>
              <button
                type="button"
                onClick={openWebApp}
                className="shrink-0 text-micro font-medium text-text-secondary transition-colors hover:text-text-primary"
              >
                Open OfferOS
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-3 rounded-xl bg-bg-base p-3">
            <p className="text-caption leading-relaxed text-text-secondary">
              No fill task for this page. Start one from the OfferOS workspace.
            </p>
            <Button variant="primary" className="mt-2 rounded-full" onClick={openWebApp}>
              Open OfferOS
            </Button>
          </div>
        )}
        {!bundle && webReachable && (
          // Keyed on job identity: a job change (see `jobChanged` above, the same
          // signal that resets task mode) must remount this card, not leave a
          // stale "Added"/"Already tracked" state showing for the new job.
          <AddJobCard
            key={jobKeyRef.current ?? "no-job"}
            capture={capture}
            api={api}
            openApplication={openApplication}
          />
        )}
        {drift && (
          <p className="mb-2 text-caption text-warning">
            Most fields here weren't recognized — this platform's adapter may be out of date.
          </p>
        )}
        {plan.length > 0 && <CoverageBar coverage={fillCoverage(plan)} />}
        <FieldGroup
          title="Required"
          items={plan.filter((i) => i.required)}
          reasonFor={reasonFor}
          onJump={jumpToField}
          writtenValue={writtenValueFor}
          revealKey={pageSigRef.current ?? undefined}
        />
        <FieldGroup
          title="Optional"
          items={plan.filter((i) => !i.required)}
          reasonFor={reasonFor}
          onJump={jumpToField}
          writtenValue={writtenValueFor}
          revealKey={pageSigRef.current ?? undefined}
        />
        {done && (
          <p className="mt-3 text-caption text-success">
            Filled — review the page, then report to the workspace.
          </p>
        )}
        {bundle && !bundle.resumeText && (
          <ArtifactCard
            title="Résumé"
            cta="Tailor résumé for this job"
            busyLabel="Tailoring…"
            hint="AI-tailors your résumé to this posting — preview before attaching."
            previewTitle="Tailored résumé preview"
            attachCta="Attach tailored PDF"
            busy={tailorBusy}
            error={tailorError}
            pdf={tailorPdf}
            attached={tailorAttached}
            onGenerate={() => void onTailor()}
            onAttach={() => void onAttachTailored()}
          />
        )}
        {bundle && !bundle.coverLetterText && (
          <ArtifactCard
            title="Cover letter"
            cta="Write cover letter"
            busyLabel="Writing…"
            hint="Grounded in your profile and tailored résumé — preview before attaching."
            previewTitle="Cover letter preview"
            attachCta="Attach cover letter PDF"
            busy={coverBusy}
            error={coverError}
            pdf={coverPdf}
            attached={coverAttached}
            onGenerate={() => void onCoverGen()}
            onAttach={() => void onAttachCover()}
          />
        )}
        {bundle && aiAnswers.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary">AI answers</p>
            <ul className="space-y-2 text-body">
              {aiAnswers.map((a) => (
                <li key={a.fieldId} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-text-primary">{a.label}</span>
                    <button
                      type="button"
                      onClick={() => void regenerateAnswer(a)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-subtle px-2.5 py-0.5 text-micro text-text-secondary transition-[color,transform] duration-fast ease-out-strong hover:text-text-primary active:scale-[0.97]"
                    >
                      <RefreshCw aria-hidden className="h-3 w-3" />
                      Regenerate
                    </button>
                  </div>
                  {a.options ? (
                    <select
                      aria-label={`Answer: ${a.label}`}
                      className="w-full rounded-xl border border-border-subtle bg-bg-base p-2 text-caption text-text-secondary focus:outline-none focus:ring-1 focus:ring-brand"
                      value={a.answer}
                      onChange={(e) => {
                        const value = e.target.value;
                        setAiAnswers((prev) =>
                          prev.map((x) => (x.fieldId === a.fieldId ? { ...x, answer: value } : x)),
                        );
                        setSavedFieldIds((prev) => {
                          if (!prev.has(a.fieldId)) return prev;
                          const next = new Set(prev);
                          next.delete(a.fieldId);
                          return next;
                        });
                      }}
                    >
                      {!a.options.includes(a.answer) && <option value={a.answer}>{a.answer}</option>}
                      {a.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      aria-label={`Answer: ${a.label}`}
                      rows={3}
                      className="w-full rounded-xl border border-border-subtle bg-bg-base p-2 text-caption text-text-secondary focus:outline-none focus:ring-1 focus:ring-brand"
                      value={a.answer}
                      onChange={(e) => {
                        const value = e.target.value;
                        setAiAnswers((prev) =>
                          prev.map((x) => (x.fieldId === a.fieldId ? { ...x, answer: value } : x)),
                        );
                        setSavedFieldIds((prev) => {
                          if (!prev.has(a.fieldId)) return prev;
                          const next = new Set(prev);
                          next.delete(a.fieldId);
                          return next;
                        });
                      }}
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={a.answer.trim() === ""}
                      onClick={() => void acceptAnswer(a)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-subtle px-2.5 py-0.5 text-micro text-text-secondary transition-[color,transform] duration-fast ease-out-strong hover:text-text-primary active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
                    >
                      <Check aria-hidden className="h-3 w-3" />
                      Accept
                    </button>
                    {savedFieldIds.has(a.fieldId) && (
                      <span className="text-caption text-success">
                        Saved — reused next time this question appears.
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {bundle &&
          (reported ? (
            <div className="mt-3 space-y-2">
              <p className="text-caption text-success">Reported — check the workspace.</p>
              {submitState === "done" ? (
                <p className="text-caption text-success">
                  Marked as submitted — the application is closed in OfferOS.
                </p>
              ) : (
                <Button
                  className="w-full rounded-full"
                  disabled={submitState === "busy"}
                  onClick={() => void onMarkApplied()}
                >
                  {submitState === "busy" ? "Marking…" : "I've submitted — mark as applied"}
                </Button>
              )}
              {submitError && <p className="text-caption text-warning">{submitError}</p>}
            </div>
          ) : (
            <Button
              className="mt-3 w-full rounded-full"
              disabled={pending || !filledOnce}
              onClick={() => void onDone()}
            >
              Done — report to workspace
            </Button>
          ))}
      </SectionCard>
    </div>
  );
}
