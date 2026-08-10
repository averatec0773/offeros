import {
  matchOption,
  matchOptionValue,
  type FieldDescriptor,
  type FieldMeta,
} from "@offeros/autofill";
import { groupByMeta } from "./field-meta-bridge";
import type { AtsRecipe } from "./recipes";
import { deepQueryAll } from "./deep-query";
import {
  COMBOBOX_FILL,
  isComboboxResultMsg,
  SKILLS_FILL,
  isSkillsResultMsg,
} from "./combobox-protocol";

/**
 * Deterministic, content-derived field ids. The old session counter reset on
 * every content-script reload and reassigned the same `offeros-N` names to
 * DIFFERENT fields in the new DOM order — any state keyed by fieldId across a
 * reload (rehydrated reports, written rows) then painted onto the wrong rows.
 * Hashing the field's stable signals (type|name|label|autocomplete) gives the
 * same logical field the same id on every scan of the same form; `used`
 * disambiguates true duplicates by DOM order.
 */
function stableFieldId(sig: string, used: Map<string, number>): string {
  let h = 0;
  for (let i = 0; i < sig.length; i += 1) h = (h * 31 + sig.charCodeAt(i)) | 0;
  const base = (h >>> 0).toString(36);
  const n = used.get(base) ?? 0;
  used.set(base, n + 1);
  return n === 0 ? `offeros-${base}` : `offeros-${base}-${n}`;
}

/** A "required" marker carried on the TITLE element's class list — ATSes that
 *  render the asterisk as a CSS pseudo-element (Ashby: `_required_…`) leave
 *  nothing in textContent, so the class is the only DOM-visible signal. */
function classSaysRequired(el: Element | null): boolean {
  return el !== null && /(^|[^a-z])required/i.test(String(el.className ?? ""));
}

function labelInfo(el: HTMLElement): { text: string; required: boolean } {
  const id = el.getAttribute("id");
  if (id) {
    const lbl = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (lbl?.textContent) return { text: lbl.textContent.trim(), required: classSaysRequired(lbl) };
  }
  const wrapping = el.closest("label");
  if (wrapping) {
    const clone = wrapping.cloneNode(true) as HTMLElement;
    for (const control of Array.from(clone.querySelectorAll("select, input, textarea, button"))) {
      control.remove();
    }
    const text = clone.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (text) return { text, required: classSaysRequired(wrapping) };
  }
  const aria = el.getAttribute("aria-label");
  if (aria) return { text: aria.trim(), required: false };
  return { text: "", required: false };
}

function labelFor(el: HTMLElement): string {
  return labelInfo(el).text;
}

function isRequired(el: HTMLElement, label: string): boolean {
  // Native attribute and ARIA are authoritative; the "*" in a label is the
  // common ATS convention for custom widgets (react-select) that lack the attr.
  if ((el as HTMLInputElement).required || el.hasAttribute("required")) return true;
  if (el.getAttribute("aria-required") === "true") return true;
  return /\*/.test(label);
}

/** A Workday-style dropdown: a plain <button> that opens a listbox popup.
 *  Not a <select> and not a react-select combobox — its own scan/fill path. */
function isListboxButton(el: HTMLElement): boolean {
  return el instanceof HTMLButtonElement && el.getAttribute("aria-haspopup") === "listbox";
}

/** The button's rendered text is its current value; "Select One" (and the
 *  empty string) are Workday's unselected placeholders, not values. */
function listboxButtonValue(el: HTMLElement): string {
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return /^select one$/i.test(text) ? "" : text;
}

function describe(el: HTMLElement, used: Map<string, number>): FieldDescriptor {
  // Conventional label first; custom widgets with no label association (Ashby
  // comboboxes) fall back to the title element that precedes them — otherwise
  // the panel can only show the placeholder ("Start typing...").
  const li = labelInfo(el);
  const fallback = li.text ? null : precedingTitle(el, []);
  const label = li.text || fallback?.text || "";
  const titleRequired = li.required || fallback?.required || false;
  const name = el.getAttribute("name") || el.id || "";
  // A listbox button reports as "listbox", never its literal type="button":
  // it is semantically a select whose options exist only while the popup is
  // open, so the descriptor honestly carries no option list. Classification
  // still works from the label; options are matched live at fill time.
  const type = isListboxButton(el)
    ? "listbox"
    : (el.getAttribute("type") ?? el.tagName.toLowerCase()) || "text";
  const autocomplete = el.getAttribute("autocomplete") ?? "";
  const fieldId = stableFieldId(`${type}|${name}|${label}|${autocomplete}`, used);
  el.setAttribute("data-offeros-id", fieldId);
  return {
    fieldId,
    label,
    // `id` stands in when `name` is absent — real Greenhouse job-boards file
    // inputs carry id="resume"/id="cover_letter" with no name, and the id is
    // the only signal that tells the two "Attach" fields apart.
    name,
    autocomplete,
    type,
    placeholder: el.getAttribute("placeholder") ?? "",
    // Workday bakes the CURRENT value into the button's aria-label ("How Did
    // You Hear About Us? LinkedIn Required") — carrying it would let the
    // classifier read the value as a signal ("linkedin" → linkedin field).
    // The label association is authoritative for these; drop the aria-label.
    ariaLabel: type === "listbox" ? "" : (el.getAttribute("aria-label") ?? ""),
    required: isRequired(el, label) || titleRequired,
    currentValue: currentValueOf(el, type),
  };
}

/** The control's live value at scan time. File inputs report the chosen file
 *  name (value is a fakepath); everything else the raw value property. */
function currentValueOf(el: HTMLElement, type: string): string {
  if (type === "file") {
    const f = (el as HTMLInputElement).files?.[0];
    return f ? f.name : "";
  }
  if (type === "listbox") return listboxButtonValue(el);
  const v = (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
  return typeof v === "string" ? v : "";
}

function isScannable(el: HTMLElement): boolean {
  if (el.getAttribute("name") === "g-recaptcha-response") return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  return true;
}

/** The question/title text that precedes a control: walk up from it and take
 *  the first content BEFORE it whose text isn't one of `excludeTexts`
 *  (option labels for groups; empty for single controls). ATSes render
 *  "question title, then control" without label association — Ashby's choice
 *  groups AND its custom comboboxes ("Location*" above an unlabeled
 *  "Start typing..." input) both resolve through this. */
function precedingTitle(
  first: HTMLElement,
  excludeTexts: string[],
): { text: string; required: boolean } | null {
  let node: HTMLElement | null = first.closest("label")?.parentElement ?? first.parentElement;
  for (let depth = 0; depth < 4 && node; depth += 1, node = node.parentElement) {
    for (const child of Array.from(node.children)) {
      if (child.contains(first)) break; // only content that precedes the options
      const text = (child.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text && text.length <= 200 && !excludeTexts.includes(text)) {
        return { text, required: classSaysRequired(child) };
      }
    }
  }
  return null;
}

/** Grouping key for one choice control: radios group by their shared `name`;
 *  checkbox option rows (Ashby) share an id prefix `…-labeled-checkbox-N`.
 *  Null = not part of a group (a lone consent checkbox stays a single field). */
function choiceGroupKey(el: HTMLElement): string | null {
  const type = el.getAttribute("type");
  if (type === "radio") {
    const name = el.getAttribute("name");
    return name ? `radio:${name}` : null;
  }
  if (type === "checkbox") {
    const m = /^(.+)-labeled-checkbox-\d+$/.exec(el.id);
    return m ? `checkbox:${m[1]}` : null;
  }
  return null;
}

function describeGroup(
  members: HTMLElement[],
  key: string,
  used: Map<string, number>,
): FieldDescriptor {
  const first = members[0]!;
  const options = members.map((m) => labelFor(m)).filter((t) => t !== "");
  const title = precedingTitle(first, options);
  const question = title?.text ?? "";
  const fieldId = stableFieldId(`group|${key}|${question}`, used);
  first.setAttribute("data-offeros-id", fieldId);
  return {
    fieldId,
    label: question,
    name: key,
    autocomplete: "",
    type: key.startsWith("radio:") ? "radio-group" : "checkbox-group",
    placeholder: "",
    ariaLabel: "",
    required:
      members.some((m) => (m as HTMLInputElement).required) ||
      /\*/.test(question) ||
      (title?.required ?? false),
    options,
    currentValue: members
      .filter((m) => (m as HTMLInputElement).checked)
      .map((m) => labelFor(m))
      .filter((t) => t !== "")
      .join(", "),
  };
}

/** A control with no signal at all (no label, name, aria, or placeholder) is
 *  unactionable and unclassifiable — pure noise in the panel (e.g. Ashby's own
 *  "autofill from resume" file input). */
function hasAnySignal(el: HTMLElement): boolean {
  return Boolean(
    labelFor(el) ||
    el.getAttribute("name") ||
    el.id ||
    el.getAttribute("aria-label") ||
    el.getAttribute("placeholder"),
  );
}

/**
 * Build one descriptor from what the ATS itself said about a question.
 *
 * Everything here is read, not inferred: the question text is the platform's
 * own, the option list is the platform's own, and requiredness came from the
 * field definition rather than from spotting an asterisk in a label.
 */
function describeFromMeta(
  meta: FieldMeta,
  members: HTMLElement[],
  used: Map<string, number>,
): FieldDescriptor {
  const first = members[0]!;
  const single = members.length === 1;
  const choice = meta.control === "single-select" || meta.control === "multi-select";
  // Options the platform enumerated beat labels scraped off the members; fall
  // back to the members' own text only when it enumerated nothing.
  const options =
    meta.options ?? (single ? undefined : members.map((m) => labelFor(m)).filter((t) => t !== ""));
  const fieldId = stableFieldId(`meta|${meta.groupId}`, used);
  first.setAttribute("data-offeros-id", fieldId);
  const type =
    !single || (choice && options?.length)
      ? meta.control === "multi-select"
        ? "checkbox-group"
        : "radio-group"
      : (first.getAttribute("type") ?? first.tagName.toLowerCase());
  return {
    fieldId,
    label: meta.question,
    name: meta.groupId,
    autocomplete: first.getAttribute("autocomplete") ?? "",
    type,
    placeholder: first.getAttribute("placeholder") ?? "",
    ariaLabel: first.getAttribute("aria-label") ?? "",
    required: meta.required,
    ...(options?.length ? { options } : {}),
    currentValue: single
      ? currentValueOf(first, type)
      : members
          .filter((m) => (m as HTMLInputElement).checked)
          .map((m) => labelFor(m))
          .filter((t) => t !== "")
          .join(", "),
  };
}

export function scanFields(
  root: ParentNode,
  recipe: AtsRecipe,
  /** What the ATS says about its own fields, when the page exposes it. Absent
   *  or empty leaves every heuristic below exactly as it was. */
  metaByEl?: Map<Element, FieldMeta>,
): { descriptor: FieldDescriptor; el: HTMLElement }[] {
  const form = root.querySelector(recipe.formSelector) ?? root;
  // Workday renders inputs inside web-component shadow roots; pierce them when
  // the recipe opts in.
  const raw = recipe.pierceShadow
    ? deepQueryAll(form, recipe.fieldSelector).filter(
        (el): el is HTMLElement => el instanceof HTMLElement,
      )
    : Array.from(form.querySelectorAll<HTMLElement>(recipe.fieldSelector));
  const els = raw.filter(isScannable).filter(hasAnySignal);

  // Collapse choice groups (radio sets, Ashby checkbox option rows) into ONE
  // logical field each, keyed by the group's question — option rows were
  // previously scanned as N bogus fields and even text-classified ("New York
  // City Office" → city).
  const out: { descriptor: FieldDescriptor; el: HTMLElement }[] = [];
  const usedIds = new Map<string, number>();

  // Fields the ATS described itself are settled before any guessing starts, and
  // are removed from what follows. This is the whole point: grouping by the
  // platform's own field id cannot mistake eight race checkboxes for eight
  // questions the way DOM proximity did.
  const describedByMeta = new Set<HTMLElement>();
  if (metaByEl?.size) {
    for (const { meta, members } of groupByMeta(metaByEl, els)) {
      out.push({ descriptor: describeFromMeta(meta, members, usedIds), el: members[0]! });
      for (const m of members) describedByMeta.add(m);
    }
  }

  const grouped = new Map<string, HTMLElement[]>();
  for (const el of els) {
    if (describedByMeta.has(el)) continue;
    const key = choiceGroupKey(el);
    if (key) {
      const list = grouped.get(key) ?? [];
      list.push(el);
      grouped.set(key, list);
    }
  }
  const seenGroups = new Set<string>();
  for (const el of els) {
    if (describedByMeta.has(el)) continue;
    const key = choiceGroupKey(el);
    if (key && (grouped.get(key)?.length ?? 0) >= 2) {
      if (!seenGroups.has(key)) {
        seenGroups.add(key);
        const members = grouped.get(key)!;
        out.push({ descriptor: describeGroup(members, key, usedIds), el: members[0]! });
      }
      continue; // members beyond the first are folded into the group
    }
    out.push({ descriptor: describe(el, usedIds), el });
  }

  // Ashby "Yes/No" widgets: a display:none checkbox behind two visible
  // buttons. The hidden input fails isScannable, so without this pass the
  // question is entirely invisible to the panel (observed on real postings:
  // work-authorization / commute / policy-consent questions all use it).
  for (const container of Array.from(form.querySelectorAll<HTMLElement>('div[class*="_yesno"]'))) {
    const hiddenInput = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const buttons = Array.from(container.querySelectorAll("button"));
    const options = buttons.map((b) => (b.textContent ?? "").trim()).filter((t) => t !== "");
    if (!hiddenInput || options.length < 2) continue;
    const title = precedingTitle(container, options);
    const question = title?.text ?? "";
    const name = hiddenInput.getAttribute("name") || hiddenInput.id || "";
    const fieldId = stableFieldId(`group|yesno:${name}|${question}`, usedIds);
    container.setAttribute("data-offeros-id", fieldId);
    out.push({
      descriptor: {
        fieldId,
        label: question,
        name: `yesno:${name}`,
        autocomplete: "",
        // Semantically a single-choice group — reuses the whole choice-group
        // pipeline (classification short-circuit, answer-bank/AI option fill).
        type: "radio-group",
        placeholder: "",
        ariaLabel: "",
        required: /\*/.test(question) || (title?.required ?? false),
        options,
        currentValue:
          buttons.find((b) => /(^|\s)_active_/.test(b.className))?.textContent?.trim() ?? "",
      },
      el: container,
    });
  }

  // The yes/no pass appends out of document order — restore it so the panel's
  // field list reads top-to-bottom like the page. Ids are already assigned, so
  // sorting cannot destabilize them.
  out.sort((a, b) =>
    a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  return out;
}

/** All inputs belonging to the same choice group as `first` (see
 *  choiceGroupKey): radios by shared name, Ashby checkbox rows by id prefix. */
function groupMembers(doc: Document, first: HTMLInputElement): HTMLInputElement[] {
  if (first.type === "radio" && first.name) {
    return Array.from(
      doc.querySelectorAll<HTMLInputElement>(
        `input[type="radio"][name="${CSS.escape(first.name)}"]`,
      ),
    );
  }
  const m = /^(.+)-labeled-checkbox-\d+$/.exec(first.id);
  if (m) {
    const prefix = `${m[1]}-labeled-checkbox-`;
    return Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter(
      (el) => el.id.startsWith(prefix),
    );
  }
  return [first];
}

/** Answer a choice group by clicking the option whose visible label matches
 *  `value` (tolerant matching via matchOption). Verified via .checked — a
 *  real click that React observes natively. Null when no option matches
 *  or the click didn't take. */
function fillChoiceGroup(
  doc: Document,
  first: HTMLInputElement,
  value: string,
): HTMLInputElement | null {
  const members = groupMembers(doc, first);
  const labels = members.map((m) => labelFor(m));
  const target = matchOption(
    labels.map((l) => ({ label: l, value: l })),
    value,
  );
  if (!target) return null;
  const el = members[labels.indexOf(String(target.label ?? ""))];
  if (!el) return null;
  el.click();
  if (!el.checked) {
    el.checked = true;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return el.checked ? el : null;
}

/** An Ashby yes/no widget container (see the scan pass above). */
function isYesNoWidget(el: HTMLElement): boolean {
  return el instanceof HTMLDivElement && /(?:^|\s)_yesno/.test(el.className);
}

/** Answer a yes/no widget by clicking the matching visible button. React
 *  applies the selection asynchronously, so verification polls briefly for
 *  the button's active class before declaring the click landed. */
async function fillYesNoWidget(container: HTMLElement, value: string): Promise<boolean> {
  const buttons = Array.from(container.querySelectorAll("button"));
  const labels = buttons.map((b) => (b.textContent ?? "").trim());
  const target = matchOption(
    labels.map((l) => ({ label: l, value: l })),
    value,
  );
  if (!target) return false;
  const btn = buttons[labels.indexOf(String(target.label ?? ""))];
  if (!btn) return false;
  if (/(^|\s)_active_/.test(btn.className)) return true; // already selected
  btn.click();
  const win = container.ownerDocument.defaultView;
  for (let i = 0; i < 10; i += 1) {
    if (/(^|\s)_active_/.test(btn.className)) return true;
    await new Promise((r) => (win ?? window).setTimeout(r, 60));
  }
  return /(^|\s)_active_/.test(btn.className);
}

/**
 * Answer a Workday listbox-button dropdown: click the button, wait for the
 * popup listbox (a portal appended near <body> — detected as a [role=listbox]
 * that was NOT there before the click, because the phone-code multiselect
 * keeps a permanent pill listbox on the page), match the wanted value against
 * the live [role=option] rows, click the match, and verify the button's
 * rendered text changed to the chosen option. Plain DOM widget — an
 * isolated-world click sequence suffices; no MAIN-world driver needed
 * (verified live on a wd1.myworkdayjobs.com tenant).
 */
async function fillListboxButton(el: HTMLElement, value: string): Promise<boolean> {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  const sleep = (ms: number) => new Promise((r) => (win ?? window).setTimeout(r, ms));
  const listboxes = () => Array.from(doc.querySelectorAll<HTMLElement>('[role="listbox"]'));
  const current = listboxButtonValue(el);
  if (current !== "" && matchOption([{ label: current, value: current }], value) !== null) {
    return true; // already showing the wanted option — never reopen a settled field
  }
  const before = new Set(listboxes());
  el.click();
  let popup: HTMLElement | undefined;
  for (let i = 0; i < 20 && !popup; i += 1) {
    await sleep(100);
    popup = listboxes().find((lb) => !before.has(lb));
  }
  if (!popup) return false;
  const closePopup = () => {
    // Escape is unreliable on this widget (observed live); the button toggles.
    if (popup?.isConnected) el.click();
  };
  const opts = Array.from(popup.querySelectorAll<HTMLElement>('[role="option"]'));
  const target = matchOption(
    opts.map((o, idx) => ({ label: (o.textContent ?? "").trim(), value: idx })),
    value,
  );
  const hit = target && typeof target.value === "number" ? opts[target.value] : undefined;
  if (!target || !hit) {
    closePopup();
    return false;
  }
  const want = String(target.label ?? "");
  // Real mouse sequence, same as the MAIN-world react-select fallback uses.
  hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  hit.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
  hit.click();
  for (let i = 0; i < 10; i += 1) {
    const now = listboxButtonValue(el);
    // The widget may re-render the label slightly (ellipsis, spacing) — accept
    // any rendered text the shared matcher maps to the chosen option.
    if (now !== "" && matchOption([{ label: now, value: now }], want) !== null) return true;
    await sleep(100);
  }
  closePopup();
  return false;
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

function isComboboxInput(el: HTMLElement): boolean {
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

export type FillValue = { fieldId: string; value: string } | { fieldId: string; values: string[] };

/**
 * Fill the given values into the live page, returning the count of verified
 * writes plus a per-field outcome map for task mode's field reports. A field
 * appears in `outcomes` only when it was actually attempted: `"filled"` on a
 * verified write, `"failed"` when a combobox/skills driver declined it. Fields
 * skipped entirely (element gone, file input, empty skills list) are absent —
 * the caller reports them from the plan status instead.
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
    // Workday listbox-button dropdowns: click-through driver with live option
    // matching. A miss reports "failed" — the panel shows a needs-user row.
    if (el && isListboxButton(el)) {
      if (await fillListboxButton(el, value)) {
        highlight(el);
        filled++;
        outcomes.set(fieldId, "filled");
      } else {
        outcomes.set(fieldId, "failed");
      }
      continue;
    }
    if (el && isYesNoWidget(el)) {
      if (await fillYesNoWidget(el, value)) {
        highlight(el);
        filled++;
        outcomes.set(fieldId, "filled");
      } else {
        outcomes.set(fieldId, "failed");
      }
      continue;
    }
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
    if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
      const picked = fillChoiceGroup(doc, el, value);
      if (picked) {
        highlight(picked);
        filled++;
        outcomes.set(fieldId, "filled");
      } else {
        outcomes.set(fieldId, "failed");
      }
      continue;
    }
    if (isComboboxInput(el)) {
      // No retry rung here on purpose: when the driver can't drive a
      // react-select, typing into its visible input leaves the underlying
      // selection unset — the field submits empty while the input LOOKS
      // filled. Reporting "failed" keeps the panel honest; the user gets a
      // needs-user row that jumps straight to the control.
      if (await fillComboboxViaDriver(el, fieldId, value, timeoutMs)) {
        highlight(el);
        filled++;
        outcomes.set(fieldId, "filled");
      } else {
        outcomes.set(fieldId, "failed");
      }
      continue;
    }
    // A native <select> only accepts one of its own option values: assigning
    // anything else (a label like "United States" against value="US") is
    // silently reset to "" by the browser, so a raw write would report a field
    // as filled that the form will reject. Resolve the option first — with the
    // shared geo/synonym matcher — and verify the selection landed.
    if (el instanceof HTMLSelectElement) {
      const option = matchOptionValue([...el.options], value);
      const optionValue = option ? String((option as HTMLOptionElement).value ?? "") : "";
      if (option && optionValue !== "") {
        setControlledValue(el, optionValue);
      }
      if (el.value !== "" && (!option || el.value === optionValue)) {
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
