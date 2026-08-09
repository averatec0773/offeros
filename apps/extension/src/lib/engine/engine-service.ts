import { classifyField, type FieldDescriptor } from "@offeros/autofill";
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
  isEnginePingRequest,
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
  attachFile(
    fieldId: string,
    fileName: string,
    mimeType: string,
    bytesBase64: string,
  ): Promise<AttachFileResponse>;
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

  // After a real submit, ATSes navigate to a form-less confirmation page.
  // Detecting that wording turns "no form here" into evidence the panel can
  // offer as "looks submitted — mark as applied?" instead of a dead end.
  const SUBMITTED_MARKERS =
    /thank you for applying|thanks for applying|application (?:has been |was )?submitted|(?:received|we've received) your application|submission (?:was )?successful/i;

  // A posting page's route to the form: a same-origin link whose target or
  // text says "apply" (Ashby: <a href=".../application">, Greenhouse/Lever:
  // "Apply" buttons/anchors). Href-based so the jump is a plain navigation
  // the panel can perform and verify — no synthetic clicks.
  const findApplyHref = (doc: Document): string | undefined => {
    const anchors = Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const candidates = anchors.filter((a) => {
      const text = (a.textContent ?? "").trim();
      const target = a.getAttribute("href") ?? "";
      if (!(a.getBoundingClientRect().width > 0)) return false;
      if (!/apply|application/i.test(`${text} ${target}`)) return false;
      try {
        return new URL(target, doc.location.href).origin === doc.location.origin;
      } catch {
        return false;
      }
    });
    const best =
      candidates.find((a) => /\/application\/?$/.test(a.getAttribute("href") ?? "")) ??
      candidates.find((a) => /^apply/i.test((a.textContent ?? "").trim()));
    return best ? new URL(best.getAttribute("href")!, doc.location.href).toString() : undefined;
  };

  // Directory-rescue candidates: same-origin links whose path shapes like an
  // individual posting (Ashby/Lever tenant/uuid, Greenhouse /jobs/<id>). The
  // panel matches these against the held job's title.
  const POSTING_PATH = /\/(?:[0-9a-f-]{36}|jobs\/\d+)(?:\/|$)/i;
  const listPostingLinks = (doc: Document): { href: string; text: string }[] => {
    const seen = new Set<string>();
    const out: { href: string; text: string }[] = [];
    for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
      const raw = a.getAttribute("href") ?? "";
      let resolved: URL;
      try {
        resolved = new URL(raw, doc.location.href);
      } catch {
        continue;
      }
      if (resolved.origin !== doc.location.origin || !POSTING_PATH.test(resolved.pathname))
        continue;
      const text = (a.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 120) continue;
      const href = resolved.toString();
      if (seen.has(href)) continue;
      seen.add(href);
      out.push({ href, text });
      if (out.length >= 80) break;
    }
    return out;
  };

  // Every real application form asks for at least one identity field. A job
  // BOARD, by contrast, has filter dropdowns (department/location/type) and a
  // list of postings — without this check a directory reads as a form with a
  // handful of junk fields (observed live: 4 filter selects on a real board),
  // which is precisely the state that leaves a task stuck with nothing to fill.
  const IDENTITY_FIELDS = new Set([
    "fullName",
    "firstName",
    "lastName",
    "email",
    "phone",
    "resume",
  ]);
  const looksLikeApplication = (descriptors: FieldDescriptor[]): boolean =>
    descriptors.some((d) => {
      const canonical = classifyField(d);
      return canonical !== null && IDENTITY_FIELDS.has(canonical);
    });

  const scan = async (): Promise<ScanResponse> => {
    const href = url();
    const recipe = matchAts(href);
    if (!recipe) return { ok: false, reason: "not_supported" };
    const scanned = scanFields(edoc().body, recipe);
    const d0 = edoc();
    const postingLinks = listPostingLinks(d0);
    const isDirectory =
      scanned.length > 0 &&
      postingLinks.length >= 3 &&
      !looksLikeApplication(scanned.map((s) => s.descriptor));
    if (scanned.length === 0 || isDirectory) {
      const text = (d0.body?.textContent ?? "").slice(0, 20000);
      return {
        ok: false,
        reason: "no_form",
        url: href,
        submittedLikely: SUBMITTED_MARKERS.test(text),
        // A board page's apply links belong to whichever posting happens to be
        // listed first — they say nothing about the job the panel is holding.
        // Offering one as THE jump target would send the task to a stranger's
        // form; on a directory only the posting links (which get title-matched)
        // are meaningful.
        applyHref: isDirectory ? undefined : findApplyHref(d0),
        postingLinks,
      };
    }
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
    el.scrollIntoView?.({ behavior: "smooth", block: "start" });
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
    if (isEnginePingRequest(msg)) return Promise.resolve(true);
    if (isEngineScanRequest(msg)) return engine.scan();
    if (isEngineFillRequest(msg)) return engine.fill(msg.values);
    if (isEngineCaptureJdRequest(msg)) return Promise.resolve(engine.capture());
    if (isEngineAttachFileRequest(msg)) {
      return engine.attachFile(msg.fieldId, msg.fileName, msg.mimeType, msg.bytesBase64);
    }
    if (isEngineScrollToFieldRequest(msg))
      return Promise.resolve(engine.scrollToField(msg.fieldId));
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
