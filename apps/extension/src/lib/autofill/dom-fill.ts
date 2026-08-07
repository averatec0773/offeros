import type { FieldDescriptor } from "@offeros/autofill";
import type { AtsRecipe } from "./recipes";
import { deepQueryAll } from "./deep-query";
import {
  COMBOBOX_FILL,
  isComboboxResultMsg,
  SKILLS_FILL,
  isSkillsResultMsg,
} from "./combobox-protocol";

let counter = 0;

export function labelFor(el: HTMLElement): string {
  const id = el.getAttribute("id");
  if (id) {
    const lbl = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (lbl?.textContent) return lbl.textContent.trim();
  }
  const wrapping = el.closest("label");
  if (wrapping) {
    const clone = wrapping.cloneNode(true) as HTMLElement;
    for (const control of Array.from(clone.querySelectorAll("select, input, textarea, button"))) {
      control.remove();
    }
    const text = clone.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (text) return text;
  }
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  return "";
}

function isRequired(el: HTMLElement, label: string): boolean {
  // Native attribute and ARIA are authoritative; the "*" in a label is the
  // common ATS convention for custom widgets (react-select) that lack the attr.
  if ((el as HTMLInputElement).required || el.hasAttribute("required")) return true;
  if (el.getAttribute("aria-required") === "true") return true;
  return /\*/.test(label);
}

function describe(el: HTMLElement): FieldDescriptor {
  const fieldId = `offeros-${++counter}`;
  el.setAttribute("data-offeros-id", fieldId);
  const label = labelFor(el);
  return {
    fieldId,
    label,
    // `id` stands in when `name` is absent — real Greenhouse job-boards file
    // inputs carry id="resume"/id="cover_letter" with no name, and the id is
    // the only signal that tells the two "Attach" fields apart.
    name: el.getAttribute("name") || el.id || "",
    autocomplete: el.getAttribute("autocomplete") ?? "",
    type: (el.getAttribute("type") ?? el.tagName.toLowerCase()) || "text",
    placeholder: el.getAttribute("placeholder") ?? "",
    ariaLabel: el.getAttribute("aria-label") ?? "",
    required: isRequired(el, label),
  };
}

function isScannable(el: HTMLElement): boolean {
  if (el.getAttribute("name") === "g-recaptcha-response") return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  return true;
}

export function scanFields(
  root: ParentNode,
  recipe: AtsRecipe,
): { descriptor: FieldDescriptor; el: HTMLElement }[] {
  const form = root.querySelector(recipe.formSelector) ?? root;
  // Workday renders inputs inside web-component shadow roots; pierce them when
  // the recipe opts in.
  const raw = recipe.pierceShadow
    ? deepQueryAll(form, recipe.fieldSelector).filter(
        (el): el is HTMLElement => el instanceof HTMLElement,
      )
    : Array.from(form.querySelectorAll<HTMLElement>(recipe.fieldSelector));
  const els = raw.filter(isScannable);
  return els.map((el) => ({ descriptor: describe(el), el }));
}

type Fillable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function setControlledValue(el: Fillable, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Attach a file to a file <input> by assigning a synthetic DataTransfer's
 * FileList, then dispatching input+change so any React/JS listener on the
 * field observes it. Verifies by re-reading `input.files` afterward — a
 * site that ignores the programmatic assignment (or clears it) must not be
 * reported as filled; the caller falls back to the manual-attach reason on
 * a false return.
 */
export function attachFile(input: HTMLInputElement, file: File): boolean {
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const attached = input.files;
  return attached !== null && attached.length === 1 && attached[0]?.name === file.name;
}

export function highlight(el: HTMLElement): void {
  el.classList.add("offeros-filled");
  el.ownerDocument.defaultView?.setTimeout(() => el.classList.remove("offeros-filled"), 800);
}

export function resolveFieldEl(doc: Document, fieldId: string): HTMLElement | null {
  return doc.querySelector<HTMLElement>(`[data-offeros-id="${CSS.escape(fieldId)}"]`);
}

export function isComboboxInput(el: HTMLElement): boolean {
  return (
    el instanceof HTMLInputElement &&
    (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") === "list")
  );
}

function fillComboboxViaDriver(
  el: HTMLElement,
  fieldId: string,
  value: string,
  timeoutMs: number,
): Promise<boolean> {
  const win = el.ownerDocument.defaultView;
  if (!win) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      win.clearTimeout(timer);
      win.removeEventListener("message", onMessage);
      resolve(ok);
    };
    const timer = win.setTimeout(() => finish(false), timeoutMs);
    function onMessage(ev: MessageEvent) {
      const d: unknown = ev.data;
      if (!isComboboxResultMsg(d) || d.fieldId !== fieldId) return;
      finish(d.ok);
    }
    win.addEventListener("message", onMessage);
    win.postMessage({ kind: COMBOBOX_FILL, fieldId, value }, "*");
  });
}

function fillSkillsViaDriver(
  doc: Document,
  fieldId: string,
  values: string[],
  timeoutMs: number,
): Promise<number> {
  const win = doc.defaultView;
  if (!win) return Promise.resolve(0);
  return new Promise((resolve) => {
    const finish = (filled: number) => {
      win.clearTimeout(timer);
      win.removeEventListener("message", onMessage);
      resolve(filled);
    };
    const timer = win.setTimeout(() => finish(0), timeoutMs);
    function onMessage(ev: MessageEvent) {
      const d: unknown = ev.data;
      if (!isSkillsResultMsg(d) || d.fieldId !== fieldId) return;
      finish(d.filled);
    }
    win.addEventListener("message", onMessage);
    win.postMessage({ kind: SKILLS_FILL, fieldId, values }, "*");
  });
}

export type FillValue =
  | { fieldId: string; value: string }
  | { fieldId: string; values: string[] };

/**
 * Fill values by re-resolving each field from the live document at fill time —
 * element references held from scan time go stale when SPA hosts re-render.
 * File inputs are never written (never-submit + no-file-write invariants).
 * Combobox fields (react-select) route over postMessage to the MAIN-world
 * driver and count as filled ONLY on a verified ok:true reply (timeout or
 * failure → not counted, keeping the returned count truthful). Skills fields
 * carry an array and route to the driver's multi-tag loop; the field counts as
 * one filled when at least one skill was tagged.
 * Returns the number of fields actually filled.
 */
export async function applyFill(
  doc: Document,
  values: FillValue[],
  opts?: { comboTimeoutMs?: number; skillsTimeoutMs?: number },
): Promise<number> {
  return (await applyFillDetailed(doc, values, opts)).filled;
}

/**
 * Same fill routine as `applyFill`, but additionally returns a per-field
 * outcome map for task mode's field reports. A field appears in `outcomes` only
 * when it was actually attempted: `"filled"` on a verified write, `"failed"`
 * when a combobox/skills driver declined it. Fields skipped entirely (element
 * gone, file input, empty skills list) are absent — the caller reports them
 * from the plan status instead. `filled` matches `applyFill` exactly.
 */
export async function applyFillDetailed(
  doc: Document,
  values: FillValue[],
  opts?: { comboTimeoutMs?: number; skillsTimeoutMs?: number },
): Promise<{ filled: number; outcomes: Map<string, "filled" | "failed"> }> {
  const timeoutMs = opts?.comboTimeoutMs ?? 2500;
  const skillsTimeoutMs = opts?.skillsTimeoutMs ?? 15000;
  const outcomes = new Map<string, "filled" | "failed">();
  let filled = 0;
  for (const item of values) {
    // Skills: a multi-value tag field. Route the whole list to the driver loop.
    if ("values" in item) {
      if (resolveFieldEl(doc, item.fieldId) && item.values.length > 0) {
        const tagged = await fillSkillsViaDriver(doc, item.fieldId, item.values, skillsTimeoutMs);
        if (tagged > 0) {
          filled++;
          outcomes.set(item.fieldId, "filled");
        } else {
          outcomes.set(item.fieldId, "failed");
        }
      }
      continue;
    }
    const { fieldId, value } = item;
    const el = resolveFieldEl(doc, fieldId);
    if (
      !(
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      ) ||
      (el instanceof HTMLInputElement && el.type === "file")
    ) {
      continue;
    }
    if (isComboboxInput(el)) {
      if (await fillComboboxViaDriver(el, fieldId, value, timeoutMs)) {
        highlight(el);
        filled++;
        outcomes.set(fieldId, "filled");
      } else {
        outcomes.set(fieldId, "failed");
      }
      continue;
    }
    setControlledValue(el, value);
    highlight(el);
    filled++;
    outcomes.set(fieldId, "filled");
  }
  return { filled, outcomes };
}
