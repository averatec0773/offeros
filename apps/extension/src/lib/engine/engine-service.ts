import { classifyField, type FieldDescriptor } from "@offeros/autofill";
import {
  matchAts,
  companyFromDocTitle,
  companyFromUrl,
  looksLikeApplicationForm,
  GENERIC_RECIPE,
} from "../autofill/recipes";
import {
  scanFields,
  applyFillDetailed,
  attachFile as domAttachFile,
  findFileInputNear,
  resolveFieldEl,
  highlight,
  type FillValue,
} from "../autofill/dom-fill";
import { readFieldMeta } from "../autofill/field-meta-bridge";
import { readWizard } from "../autofill/wizard-dom";
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
  isEngineExpandRepeatersRequest,
  sendEnginePageChanged,
  type ScanResponse,
  type FillResponse,
  type CaptureJdResponse,
  type AttachFileResponse,
  type ScrollToFieldResponse,
  type ExpandRepeatersResponse,
} from "../autofill/autofill-messaging";
import { expandRepeater, findRepeaters, historyKindOf } from "../autofill/repeater";

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
  expandRepeaters(want: {
    education: number;
    experience: number;
    fallback: number;
  }): Promise<ExpandRepeatersResponse>;
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
    // On an unmatched host the engine is only running because the user enabled
    // it here, and it gets the generic recipe — a plain form selector, no site
    // knowledge of any kind. But only if the page actually looks like an
    // application form: a blog comment box and a newsletter signup are both
    // forms, and answering `ok` for one would offer to put somebody's phone
    // number in it. When it does not look like one, the answer is the same
    // `not_supported` an unknown site has always given.
    const matched = matchAts(href);
    // Reading the page can itself fail (a document that has not rendered, a
    // frame that turns out to be cross-origin). A page we cannot read is not
    // one we should offer to fill, so that is the same answer as "this is not
    // an application form".
    const generic = () => {
      try {
        return looksLikeApplicationForm(edoc()) ? GENERIC_RECIPE : null;
      } catch {
        return null;
      }
    };
    const recipe = matched ?? generic();
    if (!recipe) return { ok: false, reason: "not_supported" };
    // Ask the page what its fields are before falling back to reading them.
    // Sites that expose nothing (Lever is server-rendered jQuery) return an
    // empty map and the scan proceeds exactly as it always has.
    const fieldMeta = await readFieldMeta(edoc(), recipe.fieldSelector);
    const scanned = scanFields(edoc().body, recipe, fieldMeta);
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
    const wizard = readWizard(d0);
    return {
      ok: true,
      atsId: recipe.atsId,
      url: href,
      company: meta.company,
      title: meta.title,
      descriptors: scanned.map((s) => s.descriptor),
      ...(wizard ? { wizard } : {}),
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
    const anchor = resolveFieldEl(edoc(), fieldId);
    // The descriptor may point at a custom uploader's wrapper rather than at
    // the native control it hides. Both end up at the same input.
    const el = anchor ? findFileInputNear(anchor) : null;
    if (!el) return { ok: false };
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

  // Pierce shadow roots in the change signature exactly where the scan does
  // (recipe.pierceShadow) — Workday materializes section fields inside web
  // components, and a light-DOM signature would never see them appear.
  const watch = (cb: () => void) =>
    watchPage(doc, cb, { pierce: matchAts(url())?.pierceShadow === true });

  /**
   * Open the sections that have no fields until asked.
   *
   * Education and work history are often an empty table with an Add button —
   * the rows do not exist in the DOM until something clicks it, so a scan finds
   * the button and nothing else and the application goes in with an empty
   * history. `wanted` is how many entries the caller has to place.
   */
  const expandRepeaters = async (want: {
    education: number;
    experience: number;
    fallback: number;
  }): Promise<ExpandRepeatersResponse> => {
    const sections = findRepeaters(edoc());
    const outcomes = [];
    for (const section of sections) {
      // How many rows this section needs is a property of the applicant's data,
      // not a number for them to pick: three jobs means three rows. A section
      // whose purpose cannot be read falls back to a small constant rather than
      // guessing at somebody's history.
      const kind = historyKindOf(section.name);
      const wanted = kind ? want[kind] : want.fallback;
      // A section that needs no rows is left closed rather than opened empty.
      if (wanted <= 0) continue;
      outcomes.push(await expandRepeater(section, wanted));
    }
    return {
      sections: outcomes,
      added: outcomes.reduce((sum, o) => sum + o.added, 0),
    };
  };

  return { scan, fill, capture, attachFile, scrollToField, watch, expandRepeaters };
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
    if (isEngineExpandRepeatersRequest(msg)) {
      return engine.expandRepeaters(msg.want);
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
