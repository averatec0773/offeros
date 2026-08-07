import { matchAts, companyFromDocTitle, companyFromUrl } from "../autofill/recipes";
import {
  scanFields,
  applyFillDetailed,
  attachFile as domAttachFile,
  resolveFieldEl,
  highlight,
  type FillValue,
} from "../autofill/dom-fill";
import { captureJd, sanitizeLabel } from "../autofill/jd-capture";
import { base64ToBytes } from "../autofill/base64";
import { effectiveDocOf, watchPage } from "./page-watcher";
import {
  isEngineScanRequest,
  isEngineFillRequest,
  isEngineCaptureJdRequest,
  isEngineAttachFileRequest,
  isEngineScrollToFieldRequest,
  sendEnginePageChanged,
  type ScanResponse,
  type FillResponse,
  type CaptureJdResponse,
  type AttachFileResponse,
  type ScrollToFieldResponse,
} from "../autofill/autofill-messaging";

export interface Engine {
  scan(): Promise<ScanResponse>;
  fill(values: FillValue[]): Promise<FillResponse>;
  capture(): CaptureJdResponse;
  attachFile(fieldId: string, fileName: string, mimeType: string, bytesBase64: string): Promise<AttachFileResponse>;
  scrollToField(fieldId: string): ScrollToFieldResponse;
  watch(cb: () => void): () => void;
}

/**
 * The content-script fill engine: scan/fill/capture/watch over the live page.
 * The side panel drives it over messaging (see `registerEngine`). `effectiveDocOf(doc)` is resolved at call time so iCIMS
 * same-origin iframe portals are followed after navigation, never pinned.
 */
export function createEngine(doc: Document): Engine {
  const url = () => doc.location.href;
  const edoc = () => effectiveDocOf(doc);

  const pageMeta = () => {
    const title =
      edoc().querySelector("h1")?.textContent?.trim() ||
      doc.querySelector("h1")?.textContent?.trim() ||
      doc.title.trim();
    // og:site_name → doc-title convention ("Job Application for X at Y") →
    // URL slug. Real Greenhouse job-boards pages ship neither JSON-LD nor
    // og:site_name, so without the title parse the company degraded to the
    // URL slug ("forwardnetworks", or "embed" on the embedded apply route).
    const company =
      doc.querySelector("meta[property='og:site_name']")?.getAttribute("content")?.trim() ||
      companyFromDocTitle(doc.title) ||
      companyFromUrl(url());
    return { company, title };
  };

  const scan = async (): Promise<ScanResponse> => {
    const href = url();
    const recipe = matchAts(href);
    if (!recipe) return { ok: false, reason: "not_supported" };
    const scanned = scanFields(edoc().body, recipe);
    if (scanned.length === 0) return { ok: false, reason: "no_form" };
    const meta = pageMeta();
    return {
      ok: true,
      atsId: recipe.atsId,
      url: href,
      company: meta.company,
      title: meta.title,
      descriptors: scanned.map((s) => s.descriptor),
    };
  };

  const fill = async (values: FillValue[]): Promise<FillResponse> => {
    const { filled, outcomes } = await applyFillDetailed(edoc(), values);
    // Serialize the Map to entry tuples — message passing is JSON, not
    // structured clone, and a Map would arrive as {} on the panel side.
    return { ok: true, filled, outcomes: [...outcomes] };
  };

  const capture = (): CaptureJdResponse => {
    const r = captureJd(edoc());
    const meta = pageMeta();
    return {
      jd: r.text,
      source: r.source,
      metaCompany: sanitizeLabel(meta.company || ""),
      metaTitle: sanitizeLabel(meta.title || ""),
      structuredTitle: r.title,
      structuredCompany: r.company,
      url: url(),
    };
  };

  // File input only — resolveFieldEl re-resolves at call time (stale-ref
  // survival, same as fill()). A non-file or missing element never attaches.
  const attachFile = async (
    fieldId: string,
    fileName: string,
    mimeType: string,
    bytesBase64: string,
  ): Promise<AttachFileResponse> => {
    const el = resolveFieldEl(edoc(), fieldId);
    if (!(el instanceof HTMLInputElement) || el.type !== "file") return { ok: false };
    const bytes = base64ToBytes(bytesBase64);
    // base64ToBytes always allocates a fresh, exactly-sized buffer (never a
    // subview) — .buffer is safe to hand to File as-is. Cast only to satisfy
    // BlobPart's stricter Uint8Array<ArrayBuffer> vs. the DOM lib's
    // Uint8Array<ArrayBufferLike> inference.
    const file = new File([bytes.buffer as ArrayBuffer], fileName, {
      type: mimeType || "application/octet-stream",
    });
    const ok = domAttachFile(el, file);
    if (ok) highlight(el);
    return { ok };
  };

  // Panel row → page glue: bring the field into view and flash the highlight
  // so the user can see exactly which control a panel row refers to.
  // scrollIntoView is called optionally — some test DOMs don't implement it.
  const scrollToField = (fieldId: string): ScrollToFieldResponse => {
    const el = resolveFieldEl(edoc(), fieldId);
    if (!el) return { ok: false };
    el.scrollIntoView?.({ behavior: "smooth", block: "center" });
    highlight(el);
    return { ok: true };
  };

  const watch = (cb: () => void) => watchPage(doc, cb);

  return { scan, fill, capture, attachFile, scrollToField, watch };
}

export interface EngineContext {
  onInvalidated(cb: () => void): void;
}

/**
 * Wire the engine into the content script: register a `runtime.onMessage`
 * handler for SCAN/FILL/CAPTURE_JD (returning the promise so the async response
 * flows back), and push OFFEROS_ENGINE_PAGE_CHANGED on every page change so the
 * panel re-scans. Non-engine messages fall through (return undefined). Both
 * are torn down on `ctx.onInvalidated`.
 */
export function registerEngine(doc: Document, ctx: EngineContext): Engine {
  const engine = createEngine(doc);

  const listener = (msg: unknown): Promise<unknown> | undefined => {
    if (isEngineScanRequest(msg)) return engine.scan();
    if (isEngineFillRequest(msg)) return engine.fill(msg.values);
    if (isEngineCaptureJdRequest(msg)) return Promise.resolve(engine.capture());
    if (isEngineAttachFileRequest(msg)) {
      return engine.attachFile(msg.fieldId, msg.fileName, msg.mimeType, msg.bytesBase64);
    }
    if (isEngineScrollToFieldRequest(msg)) return Promise.resolve(engine.scrollToField(msg.fieldId));
    return undefined;
  };
  browser.runtime.onMessage.addListener(listener);

  // The panel may not be open — swallow send errors.
  const stopWatch = engine.watch(() => sendEnginePageChanged());

  ctx.onInvalidated(() => {
    browser.runtime.onMessage.removeListener(listener);
    stopWatch();
  });

  return engine;
}
