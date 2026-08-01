import { useEffect, useRef, useState } from "react";
import { Check, Minus, RefreshCw, TriangleAlert, type LucideIcon } from "lucide-react";
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
} from "../lib/offeros-api";
import {
  buildFieldReports,
  isCoverLetterField,
  isTextAnswerTarget,
  matchHandoff,
  CUSTOM_UPLOADER_REASON,
  NO_FILE_REASON,
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

function StatusIcon({ status }: { status: FillItem["status"] }) {
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
    body: { question: string; label: string; context?: string; existingAnswer?: string },
  ) => Promise<ApiResult<{ answer: string }>>;
  findApplicationsByJobUrl: (jobUrl: string) => Promise<ApiResult<ApplicationSummary[]>>;
  createTaskFromJd: (input: {
    jobTitle: string;
    companyName: string;
    jobUrl: string;
    jdText: string;
  }) => Promise<ApiResult<{ id: string; applicationId: string }>>;
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

  const onAddThisJob = async () => {
    setBusy(true);
    try {
      const res = await capture();
      setCaptured(res);
      setTitle(res.structuredTitle ?? "");
      setCompany(res.structuredCompany ?? "");
      setDedupMatches(null);
      setCreatedApplicationId(null);
    } finally {
      setBusy(false);
    }
  };

  const doCreate = async () => {
    if (!captured) return;
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

// Required / Optional checklist group. Status-only: mark + label + (filled) value.
// An empty group is omitted so an ATS that marks nothing required renders no header.
function FieldGroup({ title, items }: { title: string; items: FillItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary">{title}</p>
      <ul className="space-y-1.5 text-body">
        {items.map((i) => (
          <li key={i.fieldId} className="flex items-center gap-2">
            <StatusIcon status={i.status} />
            <span className="flex-1 truncate text-text-primary">{i.label}</span>
            {i.status === "fillable" && <span className="truncate text-text-tertiary">{i.value}</span>}
          </li>
        ))}
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
  api,
  rescanNonce,
  openWebApp,
  openApplication,
  webReachable,
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
  api: FillApi;
  rescanNonce: number;
  openWebApp: () => void;
  openApplication: (applicationId: string) => void;
  webReachable: boolean;
}) {
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [scanNonce, setScanNonce] = useState(0);
  const [plan, setPlan] = useState<FillItem[]>([]);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [filledOnce, setFilledOnce] = useState(false);
  const [bundle, setBundle] = useState<FillTaskBundle | null>(null);
  const [aiAnswers, setAiAnswers] = useState<{ fieldId: string; label: string; answer: string }[]>([]);
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
  const resetTaskMode = () => {
    bundleRef.current = null;
    setBundle(null);
    reportsRef.current.clear();
    setAiAnswers([]);
    setSavedFieldIds(new Set());
    setReported(false);
    setFilledOnce(false);
    claimTriedRef.current = false;
  };

  // Write one value and report whether the DOM actually took it. An absent outcome
  // (file input, element gone) must never be treated as a successful write.
  const writeOne = async (fieldId: string, value: string): Promise<boolean> => {
    const r = await fill([{ fieldId, value }]);
    return r.outcomes?.some(([id, o]) => id === fieldId && o === "filled") ?? false;
  };

  // Fetch bytes for one OfferOS-managed file kind, then drive the content-script
  // attach + DOM verify over the messaging boundary. A 404 (nothing stored, or a
  // stale attachResume preference) and a failed DOM verify both fall back to an
  // honest needs-user reason — never a crash, never a false "filled".
  const attachManagedFile = async (
    fieldId: string,
    fetched: FileFetchResult,
    kind: "resume" | "coverLetter",
  ): Promise<WriteOutcome> => {
    const source = FILE_KIND_SOURCE[kind];
    if (!fetched.ok) {
      return { outcome: "needs-user", reason: NO_FILE_REASON, source };
    }
    const res = await attachFile(fieldId, {
      fileName: fetched.fileName,
      mimeType: fetched.mimeType,
      bytesBase64: bytesToBase64(fetched.bytes),
    });
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
      for (const [id, o] of res.outcomes ?? []) writes.set(id, o);

      // 2) cover-letter textareas ← bundle.coverLetterText verbatim (never generated).
      const coverText = b.coverLetterText?.trim() ? b.coverLetterText : null;
      if (coverText) {
        for (const cf of planForFill.filter(
          (i) => i.status === "needs-answer" && isCoverLetterField(i.label) && isTextTarget(i.fieldId),
        )) {
          if (await writeOne(cf.fieldId, coverText)) {
            writes.set(cf.fieldId, { outcome: "filled", value: coverText, source: "cover-letter" });
          }
          // a failed cover-letter write stays unreported here → needs-user.
        }
      }

      // 3) open-ended free-text → AI answer → fill. Generation or write failure leaves
      // the field unwritten so it reports as needs-user (a human must answer).
      const collected: { fieldId: string; label: string; answer: string }[] = [];
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
          collected.push({ fieldId: q.fieldId, label: q.label, answer: ans.value.answer });
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
          writes.set(t.fieldId, await attachManagedFile(t.fieldId, fetched, "resume"));
        } else if (t.classifiedType === "coverLetter" && coverText) {
          const fetched = await api.fetchArtifactPdf(b.taskId, "cover-letter");
          writes.set(t.fieldId, await attachManagedFile(t.fieldId, fetched, "coverLetter"));
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
  const regenerateAnswer = async (entry: { fieldId: string; label: string; answer: string }) => {
    const b = bundleRef.current;
    if (!b) return;
    const ans = await api.generateAnswer(b.taskId, {
      question: entry.label,
      label: entry.label,
      context: b.jdSummary ?? undefined,
      existingAnswer: entry.answer,
    });
    if (!ans.ok || !(await writeOne(entry.fieldId, ans.value.answer))) return;
    const answer = ans.value.answer;
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
      for (const [k, r] of reportsRef.current) {
        if (r.fieldId === entry.fieldId) {
          reportsRef.current.set(k, { ...r, value: entry.answer, outcome: "filled", source: "ai-generated" });
        }
      }
      await api.postReport(b.taskId, allReports(), false);
    }

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
    void scan().then((res) => {
      if (!live) return;
      setScanResult(res);
      if (!res.ok) return;
      // Plan against the claimed bundle's profile; before a claim there is no profile,
      // so everything reads as needs-answer/unknown until a bundle arrives.
      const { plan: newPlan, trace: newTrace } = explainFillPlan(res.descriptors, bundleRef.current?.fillProfile ?? null);
      setPlan(newPlan);
      traceRef.current = newTrace;

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

      // Auto-claim: one attempt per job while no bundle is held. Any failure (web app
      // down, no ticket, no match, claim rejected) is a silent no-op → panel stays in
      // the "no task" state. On success, rebuild the plan against the bundle profile.
      if (bundleRef.current === null && !claimTriedRef.current) {
        claimTriedRef.current = true;
        void (async () => {
          try {
            const pend = await api.getPending();
            if (!live || !pend.ok || pend.value.length === 0) return;
            const match = matchHandoff(pend.value, res.url, jobIdFromUrl);
            if (!match) return;
            const claimed = await api.claim(match.id);
            if (!live || !claimed.ok) return;
            bundleRef.current = claimed.value;
            setBundle(claimed.value);
            setScanNonce((n) => n + 1);
          } catch {
            // Web app unreachable / extension context invalidated → stay in "no task".
          }
        })();
      }
    });
    return () => {
      live = false;
    };
  }, [scan, rescanNonce, scanNonce]);

  if (scanResult === null) {
    return <p className="px-1 text-caption text-text-secondary">Scanning this page…</p>;
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
      </div>
    );
  }

  const fillable = plan.filter((i) => i.status === "fillable");
  const needs = plan.filter((i) => i.status === "needs-answer").length;
  const unknown = plan.filter((i) => i.status === "unknown").length;
  const drift = plan.length > 0 && classifiedRatio(plan) < 0.3;

  const onFill = async () => {
    if (pendingRef.current || done || !scanResult.ok || !bundleRef.current) return;
    await taskFillPage(plan, scanResult, traceRef.current);
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
        <FieldGroup title="Required" items={plan.filter((i) => i.required)} />
        <FieldGroup title="Optional" items={plan.filter((i) => !i.required)} />
        {done && (
          <p className="mt-3 text-caption text-success">
            Filled — review the page, then report to the workspace.
          </p>
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
                      <span className="text-caption text-success">Saved to your answers.</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {bundle &&
          (reported ? (
            <p className="mt-3 text-caption text-success">Reported — check the workspace.</p>
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
