import { useEffect, useRef, useState } from "react";
import type { FileFetchResult } from "../../lib/offeros-api";
import { CUSTOM_UPLOADER_REASON, type WriteOutcome } from "../../lib/autofill/task-mode";

/** A rendered artifact the panel is holding for the user to look at. */
export interface ArtifactPreview {
  url: string;
  fileName: string;
}

type FetchedFile = Extract<FileFetchResult, { ok: true }>;

/**
 * What one lane does differently. Everything NOT in here — the busy latch, the
 * error slot, the object-URL lifecycle, the attached flag, the reset — is the
 * same for both, which is why they share a hook instead of a copy.
 */
export interface ArtifactLaneConfig {
  /** Run the generation step server-side (a long LLM call). */
  generate: (taskId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Fetch the rendered PDF the preview shows and the attach uploads. */
  fetchPdf: (taskId: string) => Promise<FileFetchResult>;
  /** Shown when the step succeeded but the PDF did not render. */
  renderFailedError: string;
  /** Shown when this page has no upload field of this kind to attach to. */
  noFieldError: string;
  /** The id of that upload field, if the classifier found one on this page. */
  findField: () => string | undefined;
  /** Put the file into that input and verify it landed. */
  attach: (fieldId: string, fetched: FetchedFile) => Promise<WriteOutcome>;
  /** Record a verified attach: the highlight, the cumulative report, the POST. */
  recordAttached: (fieldId: string, fetched: FetchedFile) => Promise<void>;
  /** The task this lane acts on, read at click time — a claim can land, or be
   *  replaced, long after the hook was created. */
  taskId: () => string | null;
  /** True while a page fill is in flight; attaching into one would race it. */
  isFillPending: () => boolean;
  /** Applied after a generation succeeds, for a lane whose result changes how
   *  LATER page fills behave (the résumé's attach preference). */
  afterGenerate?: () => void;
}

export interface ArtifactLane {
  busy: boolean;
  error: string | null;
  pdf: ArtifactPreview | null;
  attached: boolean;
  /** Whether this session produced the artifact FOR that task. A function, not
   *  a boolean: the fill loop runs from a callback and would otherwise read a
   *  value captured when it started, and the answer has to be per-task — see
   *  `artifactTaskRef` below for why a bare flag was not enough. */
  hasGeneratedFor: (taskId: string) => boolean;
  onGenerate: () => Promise<void>;
  onAttach: () => Promise<void>;
  /** Drop everything, including the blob URL. Call when the task changes. */
  reset: () => void;
}

/**
 * Generate → preview → attach, for one kind of artifact.
 *
 * The two lanes (tailored résumé, cover letter) were written twice, and the
 * copies had already drifted: only the résumé told the rest of the panel that
 * an artifact now existed, so a cover letter generated here was invisible to
 * the next page of a multi-page form. One implementation makes that difference
 * a config field (`afterGenerate`, `hasGeneratedFor`) instead of an omission.
 */
export function useArtifactLane(config: ArtifactLaneConfig): ArtifactLane {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<ArtifactPreview | null>(null);
  const [attached, setAttached] = useState(false);
  // The bytes back the attach; the URL is the preview's and has to be revoked.
  const fetchedRef = useRef<FetchedFile | null>(null);
  const urlRef = useRef<string | null>(null);
  // `busy` is state, so two fast clicks both read the pre-render value. The
  // latch is what actually stops a second run from starting.
  const runningRef = useRef(false);
  // Which task the held artifact belongs to, or null for none.
  //
  // A generation still in flight when the user moves to another job completes
  // AFTER the reset meant to clear it and repopulates everything above. A bare
  // "we generated one" flag would then be true for the WRONG job: the preview
  // on screen is the previous posting's, and attaching it would upload that
  // file to this form and report it as filled. Every read is a comparison
  // against the task now claimed, so a stale write cannot be mistaken for a
  // current one.
  const artifactTaskRef = useRef<string | null>(null);

  const reset = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    // Clearing artifactTaskRef is what actually stops a later attach; dropping
    // the bytes just releases them. The latch is defence only — every run
    // clears it in its own `finally`, so this line covers a promise that never
    // settles and nothing else.
    fetchedRef.current = null;
    artifactTaskRef.current = null;
    runningRef.current = false;
    setPdf(null);
    setError(null);
    setBusy(false);
    setAttached(false);
  };

  const onGenerate = async () => {
    const taskId = config.taskId();
    if (!taskId || runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await config.generate(taskId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const fetched = await config.fetchPdf(taskId);
      if (!fetched.ok) {
        setError(config.renderFailedError);
        return;
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      fetchedRef.current = fetched;
      artifactTaskRef.current = taskId;
      const url = URL.createObjectURL(new Blob([fetched.bytes], { type: fetched.mimeType }));
      urlRef.current = url;
      setPdf({ url, fileName: fetched.fileName });
      // A regeneration replaces what was attached, so the page no longer holds
      // the current version — the attach button has to come back.
      setAttached(false);
      config.afterGenerate?.();
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  };

  const onAttach = async () => {
    const taskId = config.taskId();
    const fetched = fetchedRef.current;
    if (!taskId || !fetched || runningRef.current || config.isFillPending()) return;
    // Bytes from a different job than the one now claimed. Refuse rather than
    // upload them — a wrong file reported as filled is worse than no file.
    if (artifactTaskRef.current !== taskId) return;
    const fieldId = config.findField();
    if (!fieldId) {
      setError(config.noFieldError);
      return;
    }
    runningRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const outcome = await config.attach(fieldId, fetched);
      // attachManagedFile returns the object form; a bare string is the older
      // WriteOutcome shape and carries no reason.
      const normalized = typeof outcome === "string" ? { outcome, reason: undefined } : outcome;
      if (normalized.outcome !== "filled") {
        setError(normalized.reason ?? CUSTOM_UPLOADER_REASON);
        return;
      }
      setAttached(true);
      await config.recordAttached(fieldId, fetched);
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  };

  // The preview URL outlives the component otherwise: the panel unmounts
  // whenever the active tab stops being an apply page.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  return {
    busy,
    error,
    pdf,
    attached,
    hasGeneratedFor: (taskId) => artifactTaskRef.current === taskId,
    onGenerate,
    onAttach,
    reset,
  };
}
