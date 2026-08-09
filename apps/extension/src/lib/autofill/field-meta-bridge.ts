import { groupFieldMeta, toFieldMeta, type FieldMeta, type RawFieldMeta } from "@offeros/autofill";
import { READ_META, isReadMetaResultMsg } from "./combobox-protocol";
import { META_INDEX_ATTR, META_PAYLOAD_ID } from "./read-field-meta";

/**
 * Ask the MAIN world what the ATS says about this page's fields.
 *
 * The isolated world cannot read React's internals, so the work happens over
 * there and the answer comes back through the DOM: each described control is
 * stamped with an index, and one JSON script tag holds the records. This
 * function only orchestrates the handshake and joins the two together.
 *
 * A page that describes nothing — Lever is plain jQuery, with no React anywhere
 * — resolves to an empty map, and the caller keeps its existing heuristics.
 * That is the designed outcome, not a failure.
 */

const REQUEST_TIMEOUT_MS = 1200;
let nonce = 0;

function requestAnnotation(selector: string): Promise<number> {
  const mine = ++nonce;
  return new Promise((resolve) => {
    // The MAIN-world script may not be injected at all (a tab restored without
    // it, a page outside the driver's match list). Resolving on timeout keeps
    // the scan moving instead of hanging it.
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(0);
    }, REQUEST_TIMEOUT_MS);
    function onMessage(ev: MessageEvent) {
      const d: unknown = ev.data;
      if (!isReadMetaResultMsg(d) || d.nonce !== mine) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(d.described);
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ kind: READ_META, selector, nonce: mine }, "*");
  });
}

function readPayload(doc: Document): RawFieldMeta[] {
  const holder = doc.getElementById(META_PAYLOAD_ID);
  if (!holder?.textContent) return [];
  try {
    const parsed: unknown = JSON.parse(holder.textContent);
    return Array.isArray(parsed) ? (parsed as RawFieldMeta[]) : [];
  } catch {
    return [];
  }
}

/**
 * The page's own account of its fields, one entry per element that has one.
 * Elements the ATS says nothing about are simply absent.
 */
export async function readFieldMeta(
  doc: Document,
  selector: string,
): Promise<Map<Element, FieldMeta>> {
  const described = await requestAnnotation(selector);
  const out = new Map<Element, FieldMeta>();
  if (described === 0) return out;
  const records = readPayload(doc);
  for (const el of doc.querySelectorAll(`[${META_INDEX_ATTR}]`)) {
    const index = Number(el.getAttribute(META_INDEX_ATTR));
    const raw = records[index];
    if (!raw) continue;
    const meta = toFieldMeta(raw);
    if (meta) out.set(el, meta);
  }
  return out;
}

/** Group elements by the question the ATS says they belong to. */
export function groupByMeta(
  metaByEl: Map<Element, FieldMeta>,
  els: HTMLElement[],
): { meta: FieldMeta; members: HTMLElement[] }[] {
  const entries = els
    .map((el) => ({ meta: metaByEl.get(el), el }))
    .filter((e): e is { meta: FieldMeta; el: HTMLElement } => e.meta !== undefined);
  return groupFieldMeta(entries);
}
