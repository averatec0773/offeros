import { matchAts, companyFromUrl } from "../autofill/recipes";
import { scanFields, applyFillDetailed, type FillValue } from "../autofill/dom-fill";
import { captureJd } from "../autofill/jd-capture";
import { effectiveDocOf, watchPage } from "../overlay/page-watcher";
import {
  isEngineScanRequest,
  isEngineFillRequest,
  isEngineCaptureJdRequest,
  sendEnginePageChanged,
  type ScanResponse,
  type FillResponse,
  type CaptureJdResponse,
} from "../autofill/autofill-messaging";

export interface Engine {
  scan(): Promise<ScanResponse>;
  fill(values: FillValue[]): Promise<FillResponse>;
  capture(): CaptureJdResponse;
  watch(cb: () => void): () => void;
}

/**
 * The content-script fill engine: scan/fill/capture/watch over the live page.
 * The overlay drives it locally; the side panel drives it over messaging (see
 * `registerEngine`). `effectiveDocOf(doc)` is resolved at call time so iCIMS
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
    const company =
      doc.querySelector("meta[property='og:site_name']")?.getAttribute("content")?.trim() ||
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
      company: meta.company || "",
      title: meta.title || "",
      structuredTitle: r.title,
      structuredCompany: r.company,
      url: url(),
    };
  };

  const watch = (cb: () => void) => watchPage(doc, cb);

  return { scan, fill, capture, watch };
}

export interface EngineContext {
  onInvalidated(cb: () => void): void;
}

/**
 * Wire the engine into the content script: register a `runtime.onMessage`
 * handler for SCAN/FILL/CAPTURE_JD (returning the promise so the async response
 * flows back), and push OFFEROS_ENGINE_PAGE_CHANGED on every page change so the
 * panel re-scans. Non-engine messages fall through (return undefined) so other
 * listeners (FETCH_JD, etc.) still handle them. Both are torn down on
 * `ctx.onInvalidated`.
 */
export function registerEngine(doc: Document, ctx: EngineContext): Engine {
  const engine = createEngine(doc);

  const listener = (msg: unknown): Promise<unknown> | undefined => {
    if (isEngineScanRequest(msg)) return engine.scan();
    if (isEngineFillRequest(msg)) return engine.fill(msg.values);
    if (isEngineCaptureJdRequest(msg)) return Promise.resolve(engine.capture());
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
