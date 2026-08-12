import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, RefreshCw } from "lucide-react";
import { Button } from "../components/ui/button";
import { SectionCard } from "../components/ui/section-card";
import {
  classifiedRatio,
  explainFillPlan,
  fillCoverage,
  isAutoAnswerForbidden,
  needsPostFillReview,
  normalizeQuestion,
  type FieldTrace,
  type FillItem,
} from "@offeros/autofill";
import type { FillValue } from "../lib/autofill/dom-fill";
import { jobIdFromUrl } from "../lib/autofill/recipes";
import {
  pickPostingLink,
  rankPostingLinks,
  isSameTarget,
  mayAttemptRescue,
  noteRescueAttempt,
  clearRescueLog,
} from "../lib/autofill/rescue";
import { bytesToBase64 } from "../lib/autofill/base64";
import { pickEvidenceFields } from "../lib/autofill/evidence";
import type {
  ScanResponse,
  FillResponse,
  CaptureJdResponse,
  AttachFileResponse,
} from "../lib/autofill/autofill-messaging";
import type {
  AnalyzedField,
  FieldReport,
  FileFetchResult,
  FillTaskBundle,
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
  FILE_KIND_SOURCE,
  handoverList,
  type WriteOutcome,
} from "../lib/autofill/task-mode";

type OkScan = Extract<ScanResponse, { ok: true }>;

// The pieces this panel composes. They were inline until the file passed two
// thousand lines and the orchestration below became hard to find. Four are
// presentational — no state, no messaging. Two are not, and are the reason the
// file shrank: AddJobCard owns the whole add-job state machine (capture →
// confirm → dedup → create) and calls the web app itself, and useArtifactLane
// owns the generate → preview → attach machine that used to be written out
// twice, once per artifact kind.
import type { FillApi } from "./panel/fill-api";
import { describeWizard } from "@offeros/autofill";
import { stablePageId } from "../lib/autofill/page-id";
import { CoverageBar } from "./panel/coverage-bar";
import { FieldGroup } from "./panel/field-group";
import { ArtifactCard } from "./panel/artifact-card";
import { useArtifactLane } from "./panel/use-artifact-lane";
import { AddJobCard } from "./panel/add-job-card";
import { SpendMark, SPEND_TITLE } from "./spend-mark";

/** Re-exported: the panel is what callers configure, so its contract lives
 *  under its name even though the declaration moved. */
export type { FillApi };

/** Which questions an automated answer may not decide, and which need the
 *  user to review what was agreed to afterwards. Shared with the fill plan and
 *  unit-tested in @offeros/autofill — the same question shows up as a radio
 *  group on one site and a textarea on the next, and a guard that only covered
 *  one lane once let a generated visa-sponsorship answer through. */
const guardSubject = (label: string, desc?: { label?: string; options?: string[] }) => ({
  label,
  altLabel: desc?.label,
  options: desc?.options,
});

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
  expandRepeaters,
  captureTab,
  api,
  rescanNonce,
  openWebApp,
  openApplication,
  webReachable,
  tabUrl,
  getBoundHandoff,
  claimNonce = 0,
  navigateTab,
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
  /** Open the page's "Add another" sections before scanning them. Absent in
   *  contexts with no page to expand. */
  expandRepeaters?: (want: { education: number; experience: number; fallback: number }) => Promise<{
    sections: { name: string; added: number; reason?: string }[];
    added: number;
  }>;
  /** Photograph the visible tab (panel → background → captureVisibleTab).
   *  Present = incident fields get screenshots on Done; absent = no evidence,
   *  everything else identical. */
  captureTab?: () => Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }>;
  /** The handoff explicitly bound to this tab (workspace-opened tabs) — wins
   *  over URL-heuristic ticket matching when present. */
  getBoundHandoff?: () => Promise<string | null>;
  /** Bumped when the server pushes a new fill ticket — re-attempts the claim
   *  without waiting for a page change. */
  claimNonce?: number;
  /** Navigate the driven tab (self-recovery jumps). The task follows the tab,
   *  so navigation never breaks the binding. */
  navigateTab?: (url: string) => Promise<void>;
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
  // The two generate -> preview -> attach lanes. They differ in the five things
  // named below; the state machine behind them is one implementation. Config
  // callbacks close over helpers declared further down — they run on a click,
  // never during this render.
  const resumeLane = useArtifactLane({
    generate: (taskId) => api.tailorResume(taskId),
    fetchPdf: (taskId) => api.fetchArtifactPdf(taskId, "resume"),
    renderFailedError:
      "Tailored, but the PDF couldn't be rendered — check the artifact in OfferOS.",
    noFieldError: "No résumé upload field on this page — attach the file manually.",
    findField: () => findManagedFileField("resume"),
    attach: (fieldId, fetched) => attachManagedFile(fieldId, fetched, "resume"),
    recordAttached: (fieldId, fetched) => recordManagedAttach(fieldId, fetched, "resume"),
    taskId: () => bundleRef.current?.taskId ?? null,
    isFillPending: () => pendingRef.current,
    // Later page fills (wizard steps, re-fill) should attach the tailored PDF
    // now that one exists.
    afterGenerate: () => {
      const b = bundleRef.current;
      if (!b) return;
      const next: FillTaskBundle = { ...b, attachResume: "tailored" };
      bundleRef.current = next;
      setBundle(next);
    },
  });
  const coverLane = useArtifactLane({
    generate: (taskId) => api.generateCoverLetter(taskId),
    fetchPdf: (taskId) => api.fetchArtifactPdf(taskId, "cover-letter"),
    renderFailedError: "Written, but the PDF couldn't be rendered — check the artifact in OfferOS.",
    noFieldError: "No cover-letter upload field on this page — attach the file manually.",
    findField: () => findManagedFileField("coverLetter"),
    attach: (fieldId, fetched) => attachManagedFile(fieldId, fetched, "coverLetter"),
    recordAttached: (fieldId, fetched) => recordManagedAttach(fieldId, fetched, "coverLetter"),
    taskId: () => bundleRef.current?.taskId ?? null,
    isFillPending: () => pendingRef.current,
  });
  const [fitExpanded, setFitExpanded] = useState(false);
  // fieldId → the value that verifiably landed on the page. Updated live as
  // each fill phase completes (batch → cover letter → per-question AI →
  // attaches), so rows flip to their solid check one by one, each flip
  // backed by a verified DOM write.
  const [writtenFields, setWrittenFields] = useState<Map<string, string>>(new Map());
  const markWritten = (fieldId: string, value: string) =>
    setWrittenFields((prev) => new Map(prev).set(fieldId, value));
  // Policy acknowledgments this run put an answer into. They are allowed to be
  // filled (leaving them blank blocks submission), but accepting a policy is
  // the user's act — so every one is surfaced afterwards with its wording and
  // the value that went in, for them to check before they submit.
  const [policyAnswers, setPolicyAnswers] = useState<
    { fieldId: string; label: string; value: string }[]
  >([]);
  const [aiAnswers, setAiAnswers] = useState<
    { fieldId: string; label: string; answer: string; options?: string[] }[]
  >([]);
  /**
   * The AI fallback classifier's last run on this page.
   *
   * `aiApplied` is the set of fields whose mapping came from the model rather
   * than from the deterministic vocabulary — carried so the field report can
   * say so, because "the profile filled this" and "a model decided this is
   * where the profile value goes" are different claims.
   */
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  /**
   * What the agent suggests for fields the engine could not fill.
   *
   * Held rather than written: a value derived from someone's own history is
   * still theirs to approve, and the reason beside it is what makes approving
   * it an informed act rather than a leap of faith.
   */
  const [suggestions, setSuggestions] = useState<Map<string, AnalyzedField>>(new Map());
  const aiAppliedRef = useRef<Set<string>>(new Set());
  /** Per-field refine: which row is open, what was typed, which row is running,
   *  and what went wrong on it. Keyed by fieldId so two rows never share state. */
  const [refineOpen, setRefineOpen] = useState<string | null>(null);
  const [refineText, setRefineText] = useState("");
  const [refineBusy, setRefineBusy] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<Map<string, string>>(new Map());
  const [reported, setReported] = useState(false);
  /** Why a Done was refused, when it was. Shown rather than swallowed: a
   *  silently rejected Done is indistinguishable from a working one. */
  const [doneError, setDoneError] = useState<string | null>(null);
  /** Another panel has claimed this fill since we did. The report still landed
   *  — throwing away work done on a real page would be worse — but two panels
   *  writing the same record silently is worse still. */
  const [supersededBy, setSuperseded] = useState(false);
  /** Sending this page's rendered description to OfferOS. */
  const [jdBusy, setJdBusy] = useState(false);
  const [jdNote, setJdNote] = useState<string | null>(null);
  /** What opening the page's "Add another" sections did, if anything. */
  const [expandNote, setExpandNote] = useState<string | null>(null);
  /** Page signature this panel has already expanded, so a re-scan does not
   *  press Add again on rows that already exist. */
  const expandedRef = useRef<string | null>(null);
  // fieldIds whose current AI answer text has been accepted + persisted to the answer
  // bank — drives the "Saved to your answers." caption. Cleared on edit/regenerate so
  // the caption never claims an unsaved edit was saved.
  const [savedFieldIds, setSavedFieldIds] = useState<Set<string>>(new Set());

  // Self-recovery: on a form-less page while HOLDING a task, jump the bound
  // tab toward the form — the posting page's apply link first, else a
  // confident title match among a board page's posting links. Each target is
  // attempted at most once; every attempt/outcome is ledgered. Without a held
  // task the panel stays quiet (a browsing user may want the JD page itself).
  const attemptedRescueRef = useRef<Set<string>>(new Set());
  const pendingRepairRef = useRef<{ failure: string; action: string } | null>(null);
  useEffect(() => {
    const sr = scanResult;
    const b = bundleRef.current;
    if (!sr || sr.ok || sr.reason !== "no_form" || sr.submittedLikely) return;
    if (!b || !navigateTab) return;
    // A previous jump that landed on ANOTHER form-less page is a failed repair.
    if (pendingRepairRef.current) {
      const p = pendingRepairRef.current;
      pendingRepairRef.current = null;
      void api.postRepairEvent(b.taskId, "repair-failed", { ...p, detail: "still no form" });
    }
    const here = sr.url ?? tabUrl;
    // A form page's own "Application" link points at itself — never jump to
    // where we already are.
    const applyTarget =
      sr.applyHref && !(here && isSameTarget(sr.applyHref, here)) ? sr.applyHref : undefined;
    // A page listing several postings is a board even if it also carries an
    // apply link: a title match is tied to THIS job, an apply link is not, so
    // the match wins there. Belt and braces with the engine's own suppression.
    const looksLikeBoard = (sr.postingLinks?.length ?? 0) >= 3;
    const matched =
      applyTarget && !looksLikeBoard
        ? null
        : pickPostingLink(sr.postingLinks ?? [], b.job.title ?? "");
    const target = matched?.href ?? (looksLikeBoard ? undefined : applyTarget);
    if (!target || attemptedRescueRef.current.has(target)) return;
    // Budgeted per tab and remembered across the remount every jump causes.
    const store = typeof sessionStorage === "undefined" ? undefined : sessionStorage;
    if (!mayAttemptRescue(store, target)) return;
    attemptedRescueRef.current.add(target);
    noteRescueAttempt(store, target);
    const repair = applyTarget
      ? { failure: "page-not-form", action: "jump-to-apply" }
      : { failure: "board-directory", action: "jump-to-matched-posting" };
    pendingRepairRef.current = repair;
    void api.postRepairEvent(b.taskId, "repair-attempted", { ...repair, detail: target });
    void navigateTab(target);
    // Deliberately keyed on the scan alone: `api`, `b` and `tabUrl` are read
    // for the attempt but must not re-trigger it, or a bundle refresh would
    // re-navigate a page the user had already been carried to.
  }, [scanResult, navigateTab]);

  // A pushed "ticket created" event re-opens the claim window: reset the
  // once-per-job claim latch and re-scan so the fresh ticket is picked up.
  const lastClaimNonceRef = useRef(claimNonce);
  useEffect(() => {
    if (claimNonce === lastClaimNonceRef.current) return;
    lastClaimNonceRef.current = claimNonce;
    if (bundleRef.current === null) {
      claimTriedRef.current = false;
      setScanNonce((n) => n + 1);
    }
  }, [claimNonce]);

  const pendingRef = useRef(false);
  const pageSigRef = useRef<string | null>(null);
  /** Which page of the application this is — stable across the page changing
   *  shape. The merge key for every field report. */
  const pageIdRef = useRef<string | null>(null);
  const jobKeyRef = useRef<string | null>(null);
  const bundleRef = useRef<FillTaskBundle | null>(null);
  const traceRef = useRef<FieldTrace[]>([]);
  const claimTriedRef = useRef(false);
  /** True once the complete report has been posted (or is in flight) — the
   *  Done button's re-entry guard. */
  const doneRef = useRef(false);
  const lastRescanNonceRef = useRef(rescanNonce);
  // Field reports accumulate across wizard pages, keyed by (page ?? "") + fieldId,
  // re-sent cumulatively. `page` must be STABLE for a given page of the
  // application — see stablePageId.
  const reportsRef = useRef<Map<string, FieldReport>>(new Map());
  const reportKey = (r: FieldReport) => `${r.page ?? ""} ${r.fieldId}`;
  const accumulateReports = (reports: FieldReport[]) => {
    for (const r of reports) reportsRef.current.set(reportKey(r), r);
  };
  const allReports = () => Array.from(reportsRef.current.values());

  /**
   * A field the agent could usefully look at: the engine did not recognise it,
   * or recognised it and had no value. A CAPTCHA and the guarded questions are
   * excluded here as well as server-side — offering to analyse something that
   * will always come back "yours to answer" wastes the applicant's money.
   */
  const outstanding = (item: FillItem): boolean => {
    if (item.captcha === true) return false;
    if (item.status === "fillable") return false;
    return item.status === "unknown" || item.status === "needs-answer";
  };
  const resetArtifactLanes = () => {
    resumeLane.reset();
    coverLane.reset();
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
    // A task already past the fill gate was reported complete in an earlier
    // session. Say so, rather than offering a Done that silently does nothing:
    // the panel does not persist its own state, so this bundle is the only
    // evidence that the run already finished.
    const alreadyReported = b.taskParkedAtSubmit === true;
    setReported(alreadyReported);
    doneRef.current = alreadyReported;
  };

  // fieldId → the control's DOM value at the latest scan. Gates rehydrated
  // checkmarks: a report may say "filled" from an earlier session, but if the
  // page reloaded since, the value is gone — showing the check would claim
  // the page holds a value it doesn't, exactly the state that reads as
  // "OfferOS can't fill this".
  const pageValuesRef = useRef<Map<string, string>>(new Map());

  // What this field holds, from the most specific source to the least:
  //   1. a value we verifiably wrote this session,
  //   2. a rehydrated report for THIS page signature, still backed by a value
  //      on the page,
  //   3. whatever the PAGE holds — typed by the user, restored by the browser,
  //      or left by an earlier session. Not ours, but the field IS answered,
  //      and pretending otherwise makes a finished form look unfinished.
  const writtenValueFor = (fieldId: string): string | undefined => {
    const live = writtenFields.get(fieldId);
    if (live !== undefined) return live;
    const onPage = pageValuesRef.current.get(fieldId) ?? "";
    const hydrated = reportsRef.current.get(`${pageIdRef.current ?? ""} ${fieldId}`);
    if (hydrated?.outcome === "filled" && onPage !== "") return hydrated.value ?? "";
    return onPage.trim() === "" ? undefined : onPage;
  };
  const resetTaskMode = () => {
    bundleRef.current = null;
    setBundle(null);
    reportsRef.current.clear();
    setAiAnswers([]);
    setPolicyAnswers([]);
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
    resetArtifactLanes();
    setFitExpanded(false);
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

  // Mis-click recovery: reopen the task at the gate it was completed from.
  const onUndoApplied = async () => {
    const b = bundleRef.current;
    if (!b || submitState !== "done") return;
    setSubmitError(null);
    const res = await api.undoSubmission(b.taskId);
    if (res.ok) setSubmitState("idle");
    else setSubmitError(res.error);
  };

  // Write one value and report whether the DOM actually took it. An absent outcome
  // (file input, element gone) must never be treated as a successful write.
  const writeOne = async (fieldId: string, value: string): Promise<boolean> => {
    const r = await fill([{ fieldId, value }]);
    // A failure may arrive as an object carrying the page's reason for it;
    // only the literal "filled" counts as a write.
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
    // Already there. A re-fill used to attach again every time, so three runs
    // in ninety seconds left three copies of the same résumé on the employer's
    // form — which the applicant then has to notice and remove. The page's own
    // report of the chosen file is the check: same name, nothing to do.
    if (attachedFileName(fieldId) === fetched.fileName) {
      return {
        outcome: "filled",
        value: fetched.fileName,
        source,
        reason: "Already attached — left as it was.",
      };
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

  /**
   * The file this upload field already holds, as the page reports it.
   *
   * `currentValue` on a file descriptor is the chosen file's name — the scan
   * reads it from the input's own `files` list, so it is the page's account
   * rather than ours.
   */
  const attachedFileName = (fieldId: string): string =>
    (scanResult?.ok
      ? scanResult.descriptors.find((d) => d.fieldId === fieldId)?.currentValue
      : "") ?? "";

  /** This page's upload field for one of the two OfferOS-managed kinds, if the
   *  classifier found one. Both artifact lanes attach through it. */
  const findManagedFileField = (kind: "resume" | "coverLetter"): string | undefined =>
    scanResult?.ok
      ? scanResult.descriptors.find(
          (d) =>
            d.type === "file" &&
            traceRef.current.find((t) => t.fieldId === d.fieldId)?.classifiedType === kind,
        )?.fieldId
      : undefined;

  /** Fold a verified in-panel attach into the live view and the cumulative
   *  report. The rows already exist from the fill that ran before it, so this
   *  rewrites them in place rather than appending a second row per field. */
  const recordManagedAttach = async (
    fieldId: string,
    fetched: Extract<FileFetchResult, { ok: true }>,
    kind: "resume" | "coverLetter",
  ) => {
    const b = bundleRef.current;
    markWritten(fieldId, fetched.fileName);
    for (const [k, r] of reportsRef.current) {
      if (r.fieldId === fieldId) {
        reportsRef.current.set(k, {
          ...r,
          outcome: "filled",
          value: fetched.fileName,
          source: FILE_KIND_SOURCE[kind],
        });
      }
    }
    if (b && reportsRef.current.size > 0)
      await api.postReport(b.taskId, allReports(), false, b.handoffId);
  };

  // Task-mode fill for one (wizard) page: classified/personal fields from the bundle
  // profile, cover-letter textareas verbatim, AI answers for open-ended free-text,
  // résumé/cover-letter file attaches, then a cumulative FieldReport back to the
  // workspace. Any other (unrecognized) file input is still never touched.
  const taskFillPage = async (plan0: FillItem[], sr: OkScan, traceForFill: FieldTrace[]) => {
    const b = bundleRef.current;
    if (!b || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const writes = new Map<string, WriteOutcome>();
      const descriptorById = new Map(sr.descriptors.map((d) => [d.fieldId, d]));
      // The one choke point every fill flows through: never touch a field the
      // page already holds a value for. Someone answered it — the user, the
      // browser's restore, an earlier run — and overwriting it (with a profile
      // value or a generated answer) destroys their work. Read from THIS
      // scan's descriptors so the check is as fresh as the fill itself.
      const planForFill = plan0.filter(
        (i) => (descriptorById.get(i.fieldId)?.currentValue ?? "").trim() === "",
      );
      const isTextTarget = (fieldId: string) => {
        const desc = descriptorById.get(fieldId);
        return desc ? isTextAnswerTarget(desc) : false;
      };

      // 1) classified / answer-bank / skills fields the engine already resolved.
      const fillable = planForFill.filter((i) => i.status === "fillable");
      const res = await fill(
        fillable.map((i) =>
          i.values
            ? { fieldId: i.fieldId, values: i.values }
            : { fieldId: i.fieldId, value: i.value },
        ),
      );
      const valueById = new Map(
        fillable.map((i) => [i.fieldId, i.value ?? i.values?.join(", ") ?? ""]),
      );
      for (const [id, o] of res.outcomes ?? []) {
        // A field the fallback classifier placed reports its own source, so the
        // workspace can show which fields a model chose the home for. The value
        // itself still came from the profile or the answer bank.
        if (aiAppliedRef.current.has(id)) {
          const norm = typeof o === "string" ? { outcome: o } : o;
          writes.set(id, {
            ...norm,
            value: norm.outcome === "filled" ? (valueById.get(id) ?? "") : undefined,
            source: "ai-classified",
          });
        } else {
          writes.set(id, o);
        }
        if (o === "filled") markWritten(id, valueById.get(id) ?? "");
      }

      // 2) cover-letter textareas ← bundle.coverLetterText verbatim (never
      // generated). A letter written in the panel cannot fill these: what the
      // lane holds is rendered PDF bytes, not the text, and pasting anything
      // else into a cover-letter box would be inventing an application. The
      // file input below does get it; a textarea stays the user's to fill.
      const coverText = b.coverLetterText?.trim() ? b.coverLetterText : null;
      if (coverText) {
        for (const cf of planForFill.filter(
          (i) =>
            i.status === "needs-answer" && isCoverLetterField(i.label) && isTextTarget(i.fieldId),
        )) {
          if (await writeOne(cf.fieldId, coverText)) {
            writes.set(cf.fieldId, { outcome: "filled", value: coverText, source: "cover-letter" });
            markWritten(cf.fieldId, "Cover letter");
          }
          // a failed cover-letter write stays unreported here → needs-user.
        }
      }

      // The guard every AI-answered field passes, free text and choice alike:
      // voluntary self-identification is answered once in Profile → Equal
      // Employment, and work-authorization / visa questions are the user's own
      // legal assertion. A generated answer to either is a fabrication about a
      // real person on a real application — these fields stay needs-user.
      const aiForbidden = (label: string, desc?: { label?: string; options?: string[] }) =>
        isAutoAnswerForbidden(guardSubject(label, desc));

      // 3) open-ended free-text → AI answer → fill. Generation or write failure leaves
      // the field unwritten so it reports as needs-user (a human must answer).
      const collected: { fieldId: string; label: string; answer: string; options?: string[] }[] =
        [];
      for (const q of planForFill.filter(
        (i) =>
          i.status === "needs-answer" &&
          i.generatable === true &&
          !isCoverLetterField(i.label) &&
          isTextTarget(i.fieldId) &&
          !aiForbidden(i.label, descriptorById.get(i.fieldId)),
      )) {
        const ans = await api.generateAnswer(b.taskId, {
          question: q.label,
          label: q.label,
          context: b.jdSummary ?? undefined,
        });
        if (!ans.ok) continue;
        if (await writeOne(q.fieldId, ans.value.answer)) {
          writes.set(q.fieldId, {
            outcome: "filled",
            value: ans.value.answer,
            source: "ai-generated",
          });
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
          !aiForbidden(i.label, desc)
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
          writes.set(g.fieldId, {
            outcome: "filled",
            value: ans.value.answer,
            source: "ai-generated",
          });
          markWritten(g.fieldId, ans.value.answer);
          collected.push({ fieldId: g.fieldId, label: g.label, answer: ans.value.answer, options });
        }
      }
      if (collected.length > 0) {
        setAiAnswers((prev) => [
          ...prev.filter((e) => !collected.some((c) => c.fieldId === e.fieldId)),
          ...collected,
        ]);
      }

      // Everything this run committed to a policy question, whatever answered
      // it (profile, answer bank, or a generated pick).
      const acknowledged = planForFill
        .filter((i) => {
          const w = writes.get(i.fieldId);
          const wrote = typeof w === "string" ? w === "filled" : w?.outcome === "filled";
          return wrote && needsPostFillReview(guardSubject(i.label, descriptorById.get(i.fieldId)));
        })
        .map((i) => {
          const w = writes.get(i.fieldId);
          // Step-1 writes (profile / answer bank — the commonest way an
          // acknowledgment gets answered) record the bare string "filled", so
          // the value has to come from what was planned for that field.
          const value =
            typeof w === "string" ? (valueById.get(i.fieldId) ?? i.value ?? "") : (w?.value ?? "");
          return { fieldId: i.fieldId, label: i.label, value };
        });
      if (acknowledged.length > 0) {
        setPolicyAnswers((prev) => [
          ...prev.filter((p) => !acknowledged.some((a) => a.fieldId === p.fieldId)),
          ...acknowledged,
        ]);
      }

      // 4) résumé / cover-letter file attach — only the file inputs the classifier
      // recognized as one of the two OfferOS-managed kinds; cover-letter only
      // when one exists, whether it came with the bundle or was written here.
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
          // `coverText` is the bundle's snapshot of the cover-letter artifact,
          // taken when the task was claimed. A letter written in the panel
          // afterwards is not in it — without the lane's flag, page two of a
          // wizard would skip an upload the user can plainly see a preview of.
        } else if (
          t.classifiedType === "coverLetter" &&
          (coverText || coverLane.hasGeneratedFor(b.taskId))
        ) {
          const fetched = await api.fetchArtifactPdf(b.taskId, "cover-letter");
          const outcome = await attachManagedFile(t.fieldId, fetched, "coverLetter");
          writes.set(t.fieldId, outcome);
          if (typeof outcome !== "string" && outcome.outcome === "filled")
            markWritten(t.fieldId, outcome.value ?? "");
        }
      }

      // 5) build + accumulate + send the cumulative report for this page.
      const page = pageIdRef.current ?? stablePageId(sr.url, sr.wizard);
      const requiredIds = new Set(planForFill.filter((i) => i.required).map((i) => i.fieldId));
      accumulateReports(buildFieldReports(traceForFill, writes, requiredIds, page));
      await api.postReport(b.taskId, allReports(), false, b.handoffId);

      setFilledOnce(true);
      setDone(true);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  // Regenerate one AI answer: re-ask with the current answer as context, rewrite the
  // field, and re-send the report so the workspace sees the new value.
  /**
   * Ask for this answer again — optionally saying what to change about it.
   *
   * Regenerate and refine are the same call: the only difference is whether the
   * user said anything about what they wanted. Keeping them one function means
   * the write-back, the report update, and the "this is no longer the saved
   * answer" bookkeeping cannot drift between the two.
   *
   * A failure is shown on the row rather than swallowed. Silently doing nothing
   * to a button press is indistinguishable from doing nothing at all — and when
   * the model succeeded but the page refused the write, the new text is still
   * put in the panel, because it is worth copying even if the field would not
   * take it.
   */
  const regenerateAnswer = async (
    entry: {
      fieldId: string;
      label: string;
      answer: string;
      options?: string[];
    },
    instruction?: string,
  ) => {
    const b = bundleRef.current;
    if (!b || refineBusy !== null) return;
    setRefineBusy(entry.fieldId);
    setAnswerError((prev) => {
      const next = new Map(prev);
      next.delete(entry.fieldId);
      return next;
    });
    const fail = (message: string) =>
      setAnswerError((prev) => new Map(prev).set(entry.fieldId, message));
    try {
      const ans = await api.generateAnswer(b.taskId, {
        question: entry.label,
        label: entry.label,
        context: b.jdSummary ?? undefined,
        options: entry.options,
        existingAnswer: entry.answer,
        instruction,
      });
      if (!ans.ok) {
        fail(ans.error);
        return;
      }
      const answer = ans.value.answer;
      // The panel shows the new text either way — the write may still fail.
      setAiAnswers((prev) => prev.map((e) => (e.fieldId === entry.fieldId ? { ...e, answer } : e)));
      setSavedFieldIds((prev) => {
        if (!prev.has(entry.fieldId)) return prev;
        const next = new Set(prev);
        next.delete(entry.fieldId);
        return next;
      });
      if (!(await writeOne(entry.fieldId, answer))) {
        fail("The page didn't take the new answer — copy it in yourself.");
        return;
      }
      markWritten(entry.fieldId, answer);
      for (const [k, r] of reportsRef.current) {
        if (r.fieldId === entry.fieldId) {
          reportsRef.current.set(k, {
            ...r,
            value: answer,
            outcome: "filled",
            source: "ai-generated",
          });
        }
      }
      // The page already has the new text; what can still fail is the record.
      // Say so — a report that silently stays stale is how the workspace ends
      // up disagreeing with the form (the exact bug the Done fix was about).
      const posted = await api.postReport(b.taskId, allReports(), false, b.handoffId);
      if (!posted.ok) {
        fail(`The page has the new answer, but recording it failed: ${posted.error}`);
      } else if (posted.value.staleClaim === true) {
        setSuperseded(true);
      }
    } finally {
      setRefineBusy(null);
    }
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
          reportsRef.current.set(k, {
            ...r,
            value: entry.answer,
            outcome: "filled",
            source: "ai-generated",
          });
        }
      }
      const posted = await api.postReport(b.taskId, allReports(), false, b.handoffId);
      if (!posted.ok) {
        setAnswerError((prev) =>
          new Map(prev).set(entry.fieldId, `Accepted, but recording it failed: ${posted.error}`),
        );
      }
    }
    // Intentional fallthrough: the bank save below runs even when the DOM write just
    // failed. The accepted text is worth keeping in the answer bank for a future
    // application even if this particular page rejected the write.
    const list = await api.listAnswers();
    if (!list.ok) return;
    const normalized = normalizeQuestion(entry.label);
    const match = list.value.find((a) =>
      a.questionPatterns.some((p) => normalizeQuestion(p) === normalized),
    );
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
    // Re-entry guard: `reported` state lands only after the await, so a
    // double-click would post the complete report twice. The server accepts a
    // replayed complete report (it replaces rather than merges, so the same
    // snapshot twice lands the same state), but the second request — and a
    // duplicate evidence pass — is still pure waste.
    if (doneRef.current) return;
    doneRef.current = true;
    setDoneError(null);
    const posted = await api.postReport(b.taskId, allReports(), true, b.handoffId);
    if (!posted.ok) {
      doneRef.current = false; // a failed post may be retried
      // Say so. This used to return in silence, so a refused Done looked
      // exactly like a working one that had nothing left to do.
      setDoneError(posted.error ?? "Couldn't record that — try again.");
      return;
    }
    if (posted.value.staleClaim === true) setSuperseded(true);
    setReported(true);
    // Evidence pass, strictly after the report and strictly best-effort: the
    // user pressed Done and IS done — a slow or failing screenshot changes
    // nothing they can see. Scroll each incident field into view, let the
    // page settle, photograph, upload. Sequential on purpose: captureVisibleTab
    // photographs whatever is visible NOW, so parallel scrolls would caption
    // every shot with the wrong field.
    if (captureTab && scrollToField) {
      void (async () => {
        try {
          for (const report of pickEvidenceFields(allReports())) {
            await scrollToField(report.fieldId).catch(() => {});
            // Scroll animation + the highlight flash need a moment; a shot
            // taken mid-scroll photographs the wrong part of the page. Also
            // paces under Chrome's captureVisibleTab quota (2/sec) — faster
            // loops hit MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND and shots
            // start warn-and-skipping.
            await new Promise((resolve) => setTimeout(resolve, 600));
            const shot = await captureTab();
            if (!shot.ok) {
              // Wave 1 shipped a `return` here and the whole run produced ZERO
              // evidence with nothing in any log — one early failure silently
              // aborted every later shot. Log it and keep going: the next
              // field's capture may succeed, and a warn is the only way the
              // failure is diagnosable at all.
              console.warn("[offeros] evidence capture failed:", shot.error);
              continue;
            }
            const posted = await api.postEvidence(b.applicationId, {
              label: report.label,
              dataUrl: shot.dataUrl,
            });
            if (!posted.ok) console.warn("[offeros] evidence upload failed:", posted.error);
          }
        } catch {
          // Evidence must never surface an error a fill did not have.
        }
      })();
    }
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
    // Claim the handoff explicitly bound to this tab. Runs on form-less pages
    // too: the workspace binds the tab BEFORE the form exists (a posting page
    // whose Apply link hasn't been followed yet), and without the bundle the
    // panel can't self-recover toward the form at all. Unbound tabs still need
    // a real form — heuristic matching on a page we can't identify would be
    // exactly the guessing the binding replaced.
    const claimBoundHandoff = () => {
      if (bundleRef.current !== null || claimTriedRef.current) return;
      claimTriedRef.current = true;
      void (async () => {
        try {
          const bound = (await getBoundHandoff?.()) ?? null;
          if (!bound) {
            claimTriedRef.current = false; // leave the window open for an ok scan
            return;
          }
          const claimed = await api.claim(bound);
          if (!live || !claimed.ok) return;
          bundleRef.current = claimed.value;
          setBundle(claimed.value);
          hydrateFromBundle(claimed.value);
          setScanNonce((n) => n + 1);
          void expandForProfile(claimed.value, pageSigRef.current ?? "");
        } catch {
          // Web app unreachable / context invalidated → stay in "no task".
        }
      })();
    };

    const handleScan = (res: ScanResponse) => {
      setScanResult(res);
      if (!res.ok) {
        claimBoundHandoff();
        return;
      }
      // A real form ends any rescue episode: ledger the success and restore a
      // full jump budget for the next job in this tab.
      if (typeof sessionStorage !== "undefined") clearRescueLog(sessionStorage);
      if (pendingRepairRef.current && bundleRef.current) {
        const p = pendingRepairRef.current;
        pendingRepairRef.current = null;
        void api.postRepairEvent(bundleRef.current.taskId, "repair-succeeded", p);
      }
      // Plan against the claimed bundle's profile; before a claim there is no profile,
      // so everything reads as needs-answer/unknown until a bundle arrives.
      const { plan: newPlan, trace: newTrace } = explainFillPlan(
        res.descriptors,
        bundleRef.current?.fillProfile ?? null,
      );
      setPlan(newPlan);
      traceRef.current = newTrace;
      pageValuesRef.current = new Map(
        res.descriptors.map((d) => [d.fieldId, d.currentValue ?? ""]),
      );

      // Two different questions, and they used to share one answer.
      //
      // `pageSig` — every field id on the page — answers "did this page's
      // layout change?", and a content signature is exactly right for that.
      //
      // `pageId` answers "which page of this application is this?", and the
      // signature was catastrophically wrong for it: a report's merge key is
      // (page + fieldId), so the moment a conditional field appeared or a
      // validation error inserted a node, EVERY key on the page changed. The
      // server then appended a second copy of the page instead of replacing
      // it, stale needs-user rows lived forever, and the application stayed
      // pinned at "needs you". Page identity has to survive the page changing
      // shape — which is the one thing a field-set hash cannot do.
      const pageSig = res.descriptors.map((d) => d.fieldId).join("|");
      const pageId = stablePageId(res.url, res.wizard);
      // Wizard steps retitle the page, so the ATS job id is the identity when present.
      const jobId = jobIdFromUrl(res.url);
      const jobKey = jobId ? `${res.company}|${jobId}` : `${res.company}|${res.title}`;
      const prevPageSig = pageSigRef.current;
      const prevJobKey = jobKeyRef.current;
      const jobChanged = prevJobKey !== null && jobKey !== prevJobKey;
      const pageChanged = prevPageSig !== null && pageSig !== prevPageSig;
      pageSigRef.current = pageSig;
      pageIdRef.current = pageId;
      jobKeyRef.current = jobKey;

      if (jobChanged) {
        setDone(false);
        resetTaskMode();
      } else if (pageChanged) {
        setDone(false);
        // Acknowledgments belong to the page they were made on: their jump
        // targets no longer exist here, and listing them would attach one
        // page's agreements to another.
        setPolicyAnswers([]);
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
            void expandForProfile(claimed.value, pageSigRef.current ?? "");
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
      <div
        className="rounded-2xl border border-border-subtle bg-bg-elevated p-4"
        data-testid="scan-skeleton"
      >
        <div className="h-4 w-2/3 animate-pulse rounded bg-bg-base" />
        <div className="mt-2.5 h-3 w-1/2 animate-pulse rounded bg-bg-base" />
        <div className="mt-4 h-9 w-full animate-pulse rounded-full bg-bg-base" />
        <div className="mt-3 h-3 w-full animate-pulse rounded bg-bg-base" />
        <div className="mt-1.5 h-3 w-5/6 animate-pulse rounded bg-bg-base" />
        <p className="mt-3 text-caption text-text-tertiary">Scanning this page…</p>
      </div>
    );
  }

  const wizard = scanResult?.ok ? scanResult.wizard : undefined;

  if (!scanResult.ok) {
    const noForm = scanResult.reason === "no_form";
    // Evidence-based close: the form is gone AND the page reads like a
    // submission confirmation — for a held task, that's the moment to offer
    // "mark as applied" with something real behind it, not a guess.
    const submittedLikely = noForm && scanResult.submittedLikely === true && bundle !== null;
    // Directory rescue's human rung: the confident auto-jump didn't apply,
    // but the page lists postings — offer the ranked candidates for THIS job.
    const rescueCandidates =
      noForm && !submittedLikely && bundle !== null && !scanResult.applyHref
        ? rankPostingLinks(scanResult.postingLinks ?? [], bundle.job.title ?? "")
            .filter((l) => l.score > 0)
            .slice(0, 5)
        : [];
    const jumpToCandidate = (href: string) => {
      const b = bundleRef.current;
      if (b) {
        void api.postRepairEvent(b.taskId, "repair-attempted", {
          failure: "board-directory",
          action: "user-picked-posting",
          detail: href,
        });
      }
      void navigateTab?.(href);
    };
    return (
      <div className="rounded-2xl border border-border-subtle bg-bg-elevated p-4">
        <p className="text-body font-semibold text-text-primary">
          {submittedLikely
            ? "Looks submitted"
            : noForm
              ? "No form detected"
              : "Not an application form"}
        </p>
        <p className="mt-1 text-caption leading-relaxed text-text-secondary">
          {submittedLikely
            ? "This page reads like a submission confirmation."
            : noForm
              ? "Open the application step of this job to fill it."
              : "This page isn't a supported application form."}
        </p>
        {submittedLikely && (
          <div className="mt-3 space-y-2">
            {submitState === "done" ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-caption text-success">Marked as submitted.</p>
                <button
                  type="button"
                  onClick={() => void onUndoApplied()}
                  className="shrink-0 rounded-full border border-border-subtle px-2.5 py-0.5 text-micro text-text-secondary transition-colors hover:text-text-primary"
                >
                  Undo
                </button>
              </div>
            ) : (
              <Button
                className="w-full rounded-full"
                disabled={submitState === "busy"}
                onClick={() => void onMarkApplied()}
              >
                {submitState === "busy" ? "Marking…" : "Yes — mark as applied"}
              </Button>
            )}
            {submitError && <p className="text-caption text-warning">{submitError}</p>}
          </div>
        )}
        {rescueCandidates.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
              Is your job one of these?
            </p>
            <ul className="space-y-1">
              {rescueCandidates.map((c) => (
                <li key={c.href}>
                  <button
                    type="button"
                    onClick={() => jumpToCandidate(c.href)}
                    className="w-full rounded-xl border border-border-subtle bg-bg-base px-3 py-2 text-left text-caption text-text-primary transition-colors hover:border-brand"
                  >
                    {c.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* A posting page with no form yet (Lever/Ashby/Workday before the applicant
            clicks Apply) still has a JD to capture — Add-this-job only needs that, not
            a form. jobKeyRef is never set here (only an ok scan sets it), so key on the
            tab URL directly. */}
        {noForm && !bundle && webReachable && (
          <AddJobCard
            key={tabUrl || "no-job"}
            capture={capture}
            api={api}
            openApplication={openApplication}
          />
        )}
      </div>
    );
  }

  // Fields the PAGE already holds a value for — whoever put it there. They are
  // done: counting them as outstanding tells the user a filled form is
  // unfinished. They are also excluded from the fill batch, so a run never
  // clobbers an answer someone typed by hand.
  const satisfiedByPage = new Set(
    [...pageValuesRef.current].filter(([, v]) => v.trim() !== "").map(([id]) => id),
  );
  const fillable = plan.filter((i) => i.status === "fillable" && !satisfiedByPage.has(i.fieldId));
  // What a run would actually DO, not just what the profile can type in. A
  // page whose remaining work is all AI-answerable (open-ended questions, or
  // choice groups the answer bank missed) used to read "Fill 0 fields" with
  // the button disabled — the run was possible, the user just could not start
  // it. Guarded questions are excluded because the run will not answer them.
  const descriptorFor = (fieldId: string) =>
    scanResult.ok ? scanResult.descriptors.find((d) => d.fieldId === fieldId) : undefined;
  const answerable = plan.filter((i) => {
    if (i.status !== "needs-answer" || satisfiedByPage.has(i.fieldId)) return false;
    const desc = descriptorFor(i.fieldId);
    if (!desc || isAutoAnswerForbidden(guardSubject(i.label, desc))) return false;
    const isGroup = desc.type === "radio-group" || desc.type === "checkbox-group";
    if (isGroup) return (desc.options?.length ?? 0) > 0;
    if (!i.generatable || !isTextAnswerTarget(desc)) return false;
    // A cover-letter box is pasted from the bundle, never generated here, and
    // an in-panel letter arrives as PDF bytes with no text to paste (see step 2
    // of taskFillPage). With nothing to write, counting it would offer an
    // enabled button whose click does nothing.
    if (isCoverLetterField(i.label)) return (bundle?.coverLetterText ?? "").trim() !== "";
    return true;
  });
  const plannedActions = fillable.length + answerable.length;
  const needs = plan.filter(
    (i) => i.status === "needs-answer" && !satisfiedByPage.has(i.fieldId),
  ).length;
  const unknown = plan.filter(
    (i) => i.status === "unknown" && !satisfiedByPage.has(i.fieldId),
  ).length;
  const drift = plan.length > 0 && classifiedRatio(plan) < 0.3;
  // What the AI read would actually be given: the fields the deterministic
  // engine gave up on. Shown next to the button so pressing it is an informed
  // choice about spending, not a guess.
  const unrecognised = plan.filter((i) => outstanding(i)).length;
  // Built from the reports a run actually produced, not from the plan alone, so
  // a field the engine meant to fill and the page refused lands here too. Only
  // after a run: telling someone to fill six fields in before anything has been
  // attempted would be describing work that may not be theirs.
  const handover =
    reportsRef.current.size > 0 ? handoverList(plan, allReports(), satisfiedByPage) : [];

  // Panel row → page glue. traceRef is written together with `plan`, so at
  // render time the reasons match the rows being shown.
  const reasonFor = (fieldId: string) =>
    traceRef.current.find((t) => t.fieldId === fieldId)?.reason || undefined;
  const jumpToField = (fieldId: string) => {
    void scrollToField?.(fieldId)?.catch?.(() => {});
  };

  /**
   * Ask the web app what the fields the engine could not read are asking for,
   * then fill with what comes back.
   *
   * User-pressed only, and the one button in the fill path that spends the
   * user's API credit — hence the mark. What returns is a set of MAPPINGS the
   * server has already resolved against the profile and run the guards over;
   * the panel merges them into the plan a field at a time and then runs the
   * ordinary fill, so every value still goes through the same verified DOM
   * write as any other. Nothing the model wrote is typed into the page.
   */
  /**
   * The fields the deterministic engine could not fill, sent to the agent.
   *
   * The lane this replaces asked a model "which canonical field name is this?"
   * and showed it nothing about the applicant — useful for `Telefonnummer`,
   * useless for "which of your projects is most relevant to this role?". The
   * server now hands over the profile, the résumé, the job description and the
   * saved answers, which is what makes the second question answerable.
   *
   * Nothing is written here. Suggestions land in a list the applicant reads
   * and applies one at a time or all at once, because a value produced from
   * their history is still theirs to approve.
   */
  const runAnalysis = async (opts?: { onlyFieldId?: string; instruction?: string }) => {
    const b = bundleRef.current;
    if (!b || aiBusy || pendingRef.current || !scanResult.ok) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const descriptorById = new Map(scanResult.descriptors.map((d) => [d.fieldId, d]));
      const wanted = opts?.onlyFieldId
        ? plan.filter((i) => i.fieldId === opts.onlyFieldId)
        : plan.filter((i) => outstanding(i));
      const fields = wanted.map((i) => {
        const d = descriptorById.get(i.fieldId);
        return {
          fieldId: i.fieldId,
          label: i.label,
          type: d?.type ?? "text",
          options: d?.options,
          required: i.required,
          ...(d?.sectionName ? { sectionLabel: d.sectionName } : {}),
          ...(i.historyRow ? { rowIndex: i.historyRow.index } : {}),
          ...(d?.currentValue ? { currentValue: d.currentValue } : {}),
        };
      });
      if (fields.length === 0) {
        setAiError("Nothing outstanding on this page.");
        return;
      }
      const res = await api.analyzeFields(b.taskId, {
        handoffId: b.handoffId,
        fields,
        ...(opts?.instruction ? { instruction: opts.instruction } : {}),
      });
      if (!res.ok) {
        setAiError(res.error);
        return;
      }
      setSuggestions((prev) => {
        const next = new Map(prev);
        for (const f of res.value.fields) next.set(f.fieldId, f);
        return next;
      });
      setAiSummary(res.value.summary);
    } finally {
      setAiBusy(false);
    }
  };

  /** Write one suggestion into the page, through the ordinary verified path. */
  const applySuggestion = async (fieldId: string) => {
    const b = bundleRef.current;
    const suggestion = suggestions.get(fieldId);
    if (!b || !suggestion?.value) return;
    if (!(await writeOne(fieldId, suggestion.value))) {
      setAiError("The page didn't take that value — copy it in yourself.");
      return;
    }
    markWritten(fieldId, suggestion.value);
    let updated = false;
    for (const [k, r] of reportsRef.current) {
      if (r.fieldId === fieldId) {
        reportsRef.current.set(k, {
          ...r,
          value: suggestion.value,
          outcome: "filled",
          source: "agent",
          reason: suggestion.reason,
        });
        updated = true;
      }
    }
    if (!updated) {
      // Analysing before any fill run leaves no row to update, and a value
      // written to the page with no report is a value the workspace never
      // learns about. Build the row from the trace, which is what the ordinary
      // report path builds from too.
      const t = traceRef.current.find((x) => x.fieldId === fieldId);
      const item = plan.find((i) => i.fieldId === fieldId);
      const row: FieldReport = {
        fieldId,
        label: item?.label ?? t?.label ?? fieldId,
        classifiedType: t?.classifiedType ?? "unknown",
        status: t?.status ?? "needs-answer",
        value: suggestion.value,
        source: "agent",
        reason: suggestion.reason,
        outcome: "filled",
        required: item?.required === true,
        ...(pageIdRef.current ? { page: pageIdRef.current } : {}),
        ...(t?.questionKey ? { questionKey: t.questionKey } : {}),
      };
      reportsRef.current.set(reportKey(row), row);
    }
    await api.postReport(b.taskId, allReports(), false, b.handoffId);
    setSuggestions((prev) => {
      const next = new Map(prev);
      next.delete(fieldId);
      return next;
    });
  };

  const applyAllSuggestions = async () => {
    for (const [fieldId, s] of [...suggestions]) {
      if (s.value) await applySuggestion(fieldId);
    }
  };

  const dismissSuggestion = (fieldId: string) =>
    setSuggestions((prev) => {
      const next = new Map(prev);
      next.delete(fieldId);
      return next;
    });

  /**
   * Send the description as the browser sees it.
   *
   * A server fetching a page built in JavaScript gets a link-preview blurb —
   * on a real posting, 150 characters where the description is thousands,
   * because the text does not exist until a browser runs the page. The panel is
   * standing in that browser. This is the ladder's browser rung, which was
   * always reserved and never wired.
   */
  const sendJdFromPage = async () => {
    const b = bundleRef.current;
    if (!b || jdBusy) return;
    setJdBusy(true);
    setJdNote(null);
    try {
      let captured: CaptureJdResponse;
      try {
        captured = await capture();
      } catch {
        setJdNote("Couldn't read this page — reload it and try again.");
        return;
      }
      const text = captured.jd.trim();
      if (text.length < 200) {
        setJdNote("This page doesn't have enough text to be the description.");
        return;
      }
      const saved = await api.saveJdFromPage(b.applicationId, text);
      setJdNote(
        saved.ok
          ? `Saved the description from this page (${text.length.toLocaleString()} characters).`
          : (saved.error ?? "Couldn't save it — try again."),
      );
    } finally {
      setJdBusy(false);
    }
  };

  /**
   * Open the sections that hold no fields until asked, as many rows as the
   * applicant has entries.
   *
   * Education and work history are often an empty table with an Add button, so
   * the rows do not exist in the DOM until something clicks it — a scan finds
   * the button and nothing else. How many rows is a property of the data, not a
   * question for the user: three jobs means three rows. That is why this runs
   * on its own after a claim rather than behind a button somebody has to find.
   *
   * Runs once per page: `expandedRef` keeps a re-scan from clicking Add again
   * on rows that already exist.
   */
  const expandForProfile = async (b: FillTaskBundle, sig: string) => {
    if (!expandRepeaters || expandedRef.current === sig) return;
    expandedRef.current = sig;
    const want = {
      education: b.fillProfile.education?.length ?? 0,
      experience: b.fillProfile.experience?.length ?? 0,
      // A section whose purpose cannot be read from its name: one row, so the
      // user at least has something to type into.
      fallback: 1,
    };
    if (want.education === 0 && want.experience === 0) return;
    try {
      const res = await expandRepeaters(want);
      if (res.added > 0) {
        setExpandNote(
          res.sections
            .filter((s) => s.added > 0)
            .map((s) => `${s.name || "a section"}: ${s.added} row${s.added === 1 ? "" : "s"}`)
            .join(" · "),
        );
        // The rows exist only now, so the plan has to be rebuilt from them.
        setScanNonce((n) => n + 1);
      } else {
        const why = res.sections.find((s) => s.reason)?.reason;
        if (why) setExpandNote(why);
      }
    } catch {
      // A page that will not open its sections is not a failed fill.
    }
  };

  const onFill = async () => {
    if (pendingRef.current || done || !scanResult.ok || !bundleRef.current) return;
    // Fields the page already holds are skipped inside taskFillPage — the one
    // place every fill path passes through.
    await taskFillPage(plan, scanResult, traceRef.current);
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
          <span className="shrink-0 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
            Filling
          </span>
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
                      Gaps:{" "}
                      {fit.notAlignedSkills
                        .slice(0, 2)
                        .map((s) => s.skill)
                        .join(" · ")}
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
                    <p className="text-caption leading-relaxed text-text-secondary">
                      {fit.whyMatch}
                    </p>
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
            disabled={plannedActions === 0 || pending || done}
            onClick={() => void onFill()}
          >
            {`Fill ${plannedActions} ${plannedActions === 1 ? "field" : "fields"}`}
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
              This page isn't linked to an application yet. Open OfferOS and start it from there.
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
        {/* The AI read stays available whether or not the form went badly.
            It used to live inside the "most fields weren't recognised" banner,
            so on a form OfferOS mostly understood, the two or three fields that
            most needed a second opinion had no way to reach it. The banner
            remains as the loud case; the button is always here. */}
        {bundle && (
          <div className="mb-2 space-y-1.5 rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-2">
            {aiSummary ? (
              <p className="text-caption text-text-secondary">{aiSummary}</p>
            ) : drift ? (
              <p className="text-caption text-warning">
                Most fields here weren't recognized — this form doesn't look like one OfferOS knows.
              </p>
            ) : (
              <p className="text-caption text-text-secondary">
                {unrecognised > 0
                  ? `${unrecognised} field${unrecognised === 1 ? "" : "s"} left for you.`
                  : "Every field here is filled or accounted for."}
              </p>
            )}
            {aiError && <p className="text-caption text-warning">{aiError}</p>}
            {unrecognised > 0 && (
              <button
                type="button"
                onClick={() => void runAnalysis()}
                disabled={aiBusy || pending}
                title={SPEND_TITLE}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle px-3 py-1 text-caption font-semibold text-text-primary transition-[color,transform] duration-fast ease-out-strong hover:bg-bg-base active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
              >
                <SpendMark />
                {aiBusy
                  ? "Reading your profile and the job…"
                  : `AI analyse the remaining ${unrecognised} field${unrecognised === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
        )}

        {/* What the agent came back with. Held rather than written: a value
            derived from someone's own history is still theirs to approve, and
            the reason beside it is what makes approving it informed. */}
        {suggestions.size > 0 && (
          <div className="mb-2 rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-micro font-semibold uppercase tracking-wide text-text-tertiary">
                Suggestions
              </p>
              {[...suggestions.values()].some((v) => v.value) && (
                <button
                  type="button"
                  onClick={() => void applyAllSuggestions()}
                  className="rounded-full border border-border-subtle px-2.5 py-0.5 text-micro font-semibold text-text-primary transition-colors hover:bg-bg-base"
                >
                  Apply all
                </button>
              )}
            </div>
            <ul className="space-y-2">
              {[...suggestions.entries()].map(([fieldId, s]) => (
                <li key={fieldId} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => jumpToField(fieldId)}
                    className="block w-full truncate text-left text-caption font-medium text-text-primary hover:underline"
                  >
                    {plan.find((i) => i.fieldId === fieldId)?.label || fieldId}
                  </button>
                  {s.value ? (
                    <p className="rounded-lg bg-bg-base px-2 py-1 text-caption text-text-primary">
                      {s.value}
                    </p>
                  ) : (
                    <p className="text-caption text-warning">This one is yours to answer.</p>
                  )}
                  {/* Where it came from. A value with no traceable source never
                      reaches this list, so the reason is always a real one. */}
                  <p className="text-micro text-text-tertiary">{s.reason}</p>
                  <div className="flex gap-2">
                    {s.value && (
                      <button
                        type="button"
                        onClick={() => void applySuggestion(fieldId)}
                        className="rounded-full border border-border-subtle px-2.5 py-0.5 text-micro font-semibold text-text-primary transition-colors hover:bg-bg-base"
                      >
                        Apply
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => dismissSuggestion(fieldId)}
                      className="rounded-full px-2.5 py-0.5 text-micro text-text-secondary transition-colors hover:text-text-primary"
                    >
                      {s.value ? "Ignore" : "Dismiss"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* The description, from the page the user is actually looking at. The
            server can only fetch; on a page built in the browser that returns a
            blurb. This is the only place standing in the right browser. */}
        {bundle && (
          <div className="mb-2 rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-2">
            <button
              type="button"
              onClick={() => void sendJdFromPage()}
              disabled={jdBusy}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle px-3 py-1 text-caption font-semibold text-text-primary transition-[color,transform] duration-fast ease-out-strong hover:bg-bg-base active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
            >
              {jdBusy ? "Reading the page…" : "Save this page's description"}
            </button>
            {jdNote && <p className="mt-1.5 text-caption text-text-secondary">{jdNote}</p>}
          </div>
        )}
        {expandNote && (
          <p className="mb-2 text-caption text-text-secondary">Opened {expandNote}.</p>
        )}
        {plan.length > 0 && <CoverageBar coverage={fillCoverage(plan, satisfiedByPage)} />}
        {/* What is left for the person. A fill that stops short used to say so
            only by omission — the counts moved, some rows stayed pale, and
            nothing stated plainly that four fields were theirs. On a long form
            that silence reads as completion. */}
        {handover.length > 0 && (
          <div className="mt-3 rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-2">
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
              You'll need to fill {handover.length === 1 ? "this one" : `these ${handover.length}`}
            </p>
            <ul className="space-y-1">
              {handover.map((f) => (
                <li key={f.fieldId}>
                  <button
                    type="button"
                    onClick={() => jumpToField(f.fieldId)}
                    className="w-full rounded-lg px-1 py-0.5 text-left transition-colors duration-fast hover:bg-bg-base"
                  >
                    <span className="block truncate text-caption text-text-primary">{f.label}</span>
                    {f.reason && (
                      <span className="block truncate text-micro text-text-tertiary">
                        {f.reason}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-micro text-text-tertiary">
              Click one to jump to it on the page.
            </p>
          </div>
        )}
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
        {/* A multi-page application is not finished because this page is.
            Saying "filled" on step 2 of 7 would be wrong in the way that
            matters most — it reads as "done". */}
        {done && wizard && !wizard.onFinalStep && (
          <p className="mt-3 text-caption text-text-secondary">
            {describeWizard(wizard)} filled — review it, then continue on the page. I will pick up
            the next step when it loads.
          </p>
        )}
        {done && wizard?.onFinalStep && (
          <p className="mt-3 text-caption text-success">
            Last step — review everything, then submit it yourself.
          </p>
        )}
        {done && !wizard && (
          <p className="mt-3 text-caption text-success">
            Filled — check the page over, then save it to OfferOS.
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
            lane={resumeLane}
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
            lane={coverLane}
          />
        )}
        {bundle && policyAnswers.length > 0 && (
          <div className="mt-3 rounded-2xl border border-warn-bg bg-warn-bg/40 p-3">
            <p className="text-caption font-semibold text-text-primary">Check what you agreed to</p>
            <p className="mt-0.5 text-micro leading-relaxed text-text-secondary">
              These are agreements, not answers — read them on the page before you submit.
            </p>
            <ul className="mt-2 space-y-1.5">
              {policyAnswers.map((p) => (
                <li key={p.fieldId}>
                  <button
                    type="button"
                    onClick={() => jumpToField(p.fieldId)}
                    className="w-full rounded-xl bg-bg-base px-2.5 py-1.5 text-left text-micro text-text-secondary transition-colors hover:text-text-primary"
                  >
                    <span className="block text-text-primary">{p.label}</span>
                    {p.value && <span className="block truncate">answered: {p.value}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {bundle && aiAnswers.length > 0 && (
          <div className="mt-3">
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
              AI answers
            </p>
            <ul className="space-y-2 text-body">
              {aiAnswers.map((a) => (
                <li key={a.fieldId} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-text-primary">{a.label}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setRefineOpen((cur) => (cur === a.fieldId ? null : a.fieldId));
                        setRefineText("");
                      }}
                      aria-expanded={refineOpen === a.fieldId}
                      disabled={refineBusy !== null}
                      title={SPEND_TITLE}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-subtle px-2.5 py-0.5 text-micro text-text-secondary transition-[color,transform] duration-fast ease-out-strong hover:text-text-primary active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
                    >
                      <SpendMark />
                      Refine
                    </button>
                    <button
                      type="button"
                      onClick={() => void regenerateAnswer(a)}
                      disabled={refineBusy !== null}
                      title={SPEND_TITLE}
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-subtle px-2.5 py-0.5 text-micro text-text-secondary transition-[color,transform] duration-fast ease-out-strong hover:text-text-primary active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
                    >
                      <RefreshCw aria-hidden className="h-3 w-3" />
                      {refineBusy === a.fieldId ? "Working…" : "Regenerate"}
                    </button>
                  </div>
                  {refineOpen === a.fieldId && (
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const instruction = refineText.trim();
                        if (instruction === "") return;
                        setRefineOpen(null);
                        setRefineText("");
                        void regenerateAnswer(a, instruction);
                      }}
                    >
                      <input
                        autoFocus
                        aria-label={`How should this answer change? ${a.label}`}
                        placeholder="Shorter · Lead with the ML work · Less formal"
                        value={refineText}
                        onChange={(e) => setRefineText(e.target.value)}
                        className="min-w-0 flex-1 rounded-full border border-border-subtle bg-bg-base px-3 py-1 text-caption text-text-primary focus:outline-none focus:ring-1 focus:ring-brand"
                      />
                      <button
                        type="submit"
                        disabled={refineText.trim() === "" || refineBusy !== null}
                        title={SPEND_TITLE}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-subtle px-2.5 py-1 text-micro font-semibold text-text-primary transition-[color,transform] duration-fast ease-out-strong hover:bg-bg-elevated active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100"
                      >
                        <SpendMark />
                        Rewrite
                      </button>
                    </form>
                  )}
                  {answerError.get(a.fieldId) && (
                    <p className="text-caption text-warning">{answerError.get(a.fieldId)}</p>
                  )}
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
                      {!a.options.includes(a.answer) && (
                        <option value={a.answer}>{a.answer}</option>
                      )}
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
              <p className="text-caption text-success">Saved to OfferOS.</p>
              {submitState === "done" ? (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-caption text-success">
                    Marked as submitted — the application is closed in OfferOS.
                  </p>
                  <button
                    type="button"
                    onClick={() => void onUndoApplied()}
                    className="shrink-0 rounded-full border border-border-subtle px-2.5 py-0.5 text-micro text-text-secondary transition-colors hover:text-text-primary"
                  >
                    Undo
                  </button>
                </div>
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
            <div className="mt-3 space-y-2">
              <Button
                className="w-full rounded-full"
                disabled={pending || !filledOnce}
                onClick={() => void onDone()}
              >
                Done — save to OfferOS
              </Button>
              {/* A refused Done used to return in silence, which looked exactly
                  like a successful one. */}
              {doneError && <p className="text-caption text-warning">{doneError}</p>}
              {supersededBy && (
                <p className="text-caption text-warning">
                  This job was opened somewhere else since you started here — what you did was
                  saved, but check the other window before submitting.
                </p>
              )}
            </div>
          ))}
      </SectionCard>
    </div>
  );
}
