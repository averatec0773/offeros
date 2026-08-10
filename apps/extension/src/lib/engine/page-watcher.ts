import { deepQueryAll } from "../autofill/deep-query";

// Includes Workday's listbox-button dropdowns: a wizard page can be made ONLY
// of those (Application Questions), and its section pages ("My Experience")
// materialize fields after an "Add" click — if the signature cannot see the
// gained widgets, PAGE_CHANGED never fires and the panel never re-scans.
const FIELD_SELECTOR =
  'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea, button[aria-haspopup="listbox"]';

/**
 * The document that actually hosts the application content. Some ATS (iCIMS
 * careers portals) render the whole flow inside a same-origin iframe; when a
 * reachable frame holds more form fields than the top document, scan/fill/watch
 * should target it instead. Cross-origin frames are skipped.
 */
export function effectiveDocOf(top: Document): Document {
  let best = top;
  let bestCount = top.querySelectorAll(FIELD_SELECTOR).length;
  for (const frame of Array.from(top.querySelectorAll("iframe"))) {
    let d: Document | null = null;
    try {
      d = (frame as HTMLIFrameElement).contentDocument;
    } catch {
      d = null; // cross-origin
    }
    if (!d?.body) continue;
    const count = d.querySelectorAll(FIELD_SELECTOR).length;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Cheap page identity: top URL + effective-doc URL + field count + name hash.
 *  `pierce` counts fields through open shadow roots too — Workday materializes
 *  section fields inside web components, invisible to a light-DOM count, so
 *  without it the signature stays constant and the gained fields never trigger
 *  a rescan. One deep walk per debounced check (600ms) keeps it cheap. */
export function pageSignature(doc: Document, opts: { pierce?: boolean } = {}): string {
  const eff = effectiveDocOf(doc);
  const fields = opts.pierce
    ? deepQueryAll(eff, FIELD_SELECTOR)
    : eff.querySelectorAll(FIELD_SELECTOR);
  let hash = 0;
  for (const el of fields) {
    const key = `${el.getAttribute("name") ?? el.id ?? el.tagName};`;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const effHref = eff === doc ? "" : eff.location.href;
  return `${doc.location.href}|${effHref}|${fields.length}|${hash}`;
}

/**
 * Watch for SPA page changes: popstate/hashchange + DOM mutations + iframe
 * loads, debounced, firing onChange only when the page signature actually
 * changed. The mutation observer follows the CURRENT effective document —
 * an iframe navigation replaces its contentDocument without touching the
 * parent DOM, so the frame's capture-phase `load` event is the re-attach
 * signal. No history monkey-patching (isolated world cannot see page-world
 * pushState; content navigations always fire one of the hooks above).
 */
export function watchPage(
  doc: Document,
  onChange: () => void,
  opts: { debounceMs?: number; pierce?: boolean } = {},
): () => void {
  const debounceMs = opts.debounceMs ?? 600;
  const sig = () => pageSignature(doc, { pierce: opts.pierce });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attachedDoc: Document | null = null;
  let attachedObserver: MutationObserver | null = null;

  const attachTo = (d: Document): void => {
    if (attachedDoc === d || !d.body) return;
    attachedObserver?.disconnect();
    attachedObserver = new MutationObserver(schedule);
    attachedObserver.observe(d.body, { childList: true, subtree: true });
    attachedDoc = d;
  };

  const check = (): void => {
    const eff = effectiveDocOf(doc);
    if (eff !== doc) attachTo(eff); // follow the live iframe document
    const s = sig();
    if (s !== last) {
      last = s;
      onChange();
    }
  };
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(check, debounceMs);
  };

  let last = sig();
  const win = doc.defaultView;
  win?.addEventListener("popstate", schedule);
  win?.addEventListener("hashchange", schedule);
  const topObserver = new MutationObserver(schedule);
  topObserver.observe(doc.body, { childList: true, subtree: true });
  // `load` doesn't bubble — capture phase catches every (re)loading frame.
  const onFrameLoad = (e: Event): void => {
    if ((e.target as Element | null)?.tagName === "IFRAME") schedule();
  };
  doc.addEventListener("load", onFrameLoad, true);
  const initialEff = effectiveDocOf(doc);
  if (initialEff !== doc) attachTo(initialEff);

  return () => {
    clearTimeout(timer);
    topObserver.disconnect();
    attachedObserver?.disconnect();
    win?.removeEventListener("popstate", schedule);
    win?.removeEventListener("hashchange", schedule);
    doc.removeEventListener("load", onFrameLoad, true);
  };
}
