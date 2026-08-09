import type { RawFieldMeta } from "@offeros/autofill";

/**
 * Pull each control's own description off the page.
 *
 * This has to run in the MAIN world. React attaches `__reactFiber$…` to DOM
 * nodes as ordinary JavaScript properties, and an isolated content-script world
 * gets its own wrappers for those nodes — the properties are simply not there.
 * The extension already crosses that boundary to drive react-select
 * (`entrypoints/ats-driver.content.ts`); this is the same door used to read
 * instead of write.
 *
 * Everything here was verified against live application forms on 2026-08-09;
 * see docs/research/2026-08-09-field-metadata-probe.md for the measurements.
 */

/** Where the annotation lands so the isolated world can read it back. DOM
 *  attributes are shared across worlds; JS properties are not. */
export const META_INDEX_ATTR = "data-offeros-meta-i";
export const META_PAYLOAD_ID = "offeros-field-meta";

interface FiberLike {
  memoizedProps?: unknown;
  return?: FiberLike | null;
}

function fiberOf(el: Element): FiberLike | null {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return null;
  return (el as unknown as Record<string, FiberLike | undefined>)[key] ?? null;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v : undefined;

/** Option lists arrive as bare strings or as `{label, value}` rows. */
function optionLabels(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .map((o) => (typeof o === "string" ? o : (str(asRecord(o)?.label) ?? str(asRecord(o)?.name))))
    .filter((s): s is string => !!s);
  return out.length ? out : undefined;
}

/**
 * Does this props object describe a field?
 *
 * The test is deliberately structural rather than a list of known component
 * names: it needs a human-readable question, a type, and at least one of the
 * things only a field definition carries. Matching on component names would
 * break the first time a platform renamed one, which is the exact fragility
 * this whole approach exists to avoid.
 */
function readDefinition(props: unknown): RawFieldMeta | null {
  const p = asRecord(props);
  if (!p) return null;
  const question = str(p.title) ?? str(p.label) ?? str(p.humanReadablePath);
  const platformType = str(p.type) ?? str(p.fieldType);
  if (!question || !platformType) return null;
  const options = optionLabels(p.selectableValues) ?? optionLabels(p.options);
  const hasFieldish =
    options !== undefined || "required" in p || "isNullable" in p || "readOnly" in p;
  if (!hasFieldish) return null;
  return {
    question,
    platformType,
    // Ashby gives a stable per-question id; Greenhouse and Workday do not, and
    // toFieldMeta falls back to the question text for those.
    groupId: str(p.id) ?? str(p.path),
    // Ashby inverts it: isNullable false means required.
    required: p.required === true || p.isNullable === false,
    ...(options ? { options } : {}),
    source: "props",
  };
}

/**
 * Walk up from a control looking for whoever describes it.
 *
 * Depth is bounded because a form's fiber chain reaches the app root, and the
 * app root has props too — an unbounded walk eventually finds something
 * field-shaped that has nothing to do with this control. Forty hops covers
 * every layout observed (the deepest real hit was nine).
 */
function definitionFor(el: Element): RawFieldMeta | null {
  let fiber = fiberOf(el);
  for (let hop = 0; fiber && hop < 40; hop++) {
    const direct = readDefinition(fiber.memoizedProps);
    if (direct) return direct;
    const props = asRecord(fiber.memoizedProps);
    if (props) {
      for (const key of Object.keys(props)) {
        const nested = readDefinition(props[key]);
        if (nested) return nested;
      }
    }
    fiber = fiber.return ?? null;
  }
  return null;
}

/**
 * Read one control, preferring the platform's own description and falling back
 * to its id path. Both are the ATS talking about itself; neither is inference.
 */
export function readOne(el: Element): RawFieldMeta | null {
  const fromProps = definitionFor(el);
  if (fromProps) return fromProps;
  const id = el.getAttribute("id");
  if (id?.includes("--")) {
    return {
      semanticId: id,
      groupId: id,
      required: el.getAttribute("aria-required") === "true",
      source: "semantic-id",
    };
  }
  return null;
}

/**
 * Annotate every control on the page and publish the payload.
 *
 * Each described control gets an index attribute, and the records go into one
 * JSON script tag rather than onto the elements themselves: option lists run to
 * hundreds of characters and stamping them per-control would bloat the DOM the
 * page has to keep re-rendering.
 *
 * Returns how many controls were described, so the caller can tell "this page
 * exposes nothing" from "this ran before the form rendered".
 */
export function annotateFieldMeta(doc: Document, selector: string): number {
  const els = Array.from(doc.querySelectorAll(selector));
  const records: (RawFieldMeta | null)[] = [];
  let described = 0;
  for (const el of els) {
    const raw = readOne(el);
    if (!raw) {
      el.removeAttribute(META_INDEX_ATTR);
      continue;
    }
    el.setAttribute(META_INDEX_ATTR, String(records.length));
    records.push(raw);
    described++;
  }
  let holder = doc.getElementById(META_PAYLOAD_ID);
  if (!holder) {
    holder = doc.createElement("script");
    holder.id = META_PAYLOAD_ID;
    holder.setAttribute("type", "application/json");
    doc.documentElement.appendChild(holder);
  }
  holder.textContent = JSON.stringify(records);
  return described;
}
