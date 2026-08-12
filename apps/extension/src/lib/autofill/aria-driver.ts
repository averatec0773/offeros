import { matchOptionValue } from "@offeros/autofill";

/**
 * Driving a control by what it says it is, rather than by what it is built out
 * of.
 *
 * Every driver here until now recognised an implementation: react-select by its
 * React fibre, Workday by its listbox button, Ashby by a `_yesno` class name.
 * That is the right thing to do for a site we know — those drivers are faster,
 * more precise, and they stay first. But it means a control nobody has written
 * a driver for is not merely handled badly, it is not handled at all: the fill
 * skips it in silence and the user finds an empty required field at submit.
 *
 * ARIA is the one description a custom widget is likely to have supplied
 * regardless of how it was built, because it is what a screen reader needs. A
 * `role="combobox"` with `aria-expanded`, a popup of `role="option"` rows, a
 * `role="radio"` with `aria-checked` — these are a contract the page has
 * already published about itself, and a driver can hold it to that contract.
 *
 * Options are matched with `matchOptionValue` — the same matcher the native
 * `<select>` path uses, geo synonyms and all. An unknown site is precisely
 * where a country dropdown labelled "United States" meets a profile that says
 * "US", and there is no reason the generic path should be worse at that than
 * the native one.
 *
 * The rule that keeps this honest is the same one every other driver follows:
 * a write is only reported when the page confirms it. ARIA is a description,
 * not a promise — a widget can carry all the right roles and still ignore a
 * click. So every path here ends in a verification against the page's own
 * state, and anything unconfirmed is a failure with a reason, never a
 * hopeful success.
 */

const sleepIn = (el: Element, ms: number) =>
  new Promise((r) => (el.ownerDocument.defaultView ?? window).setTimeout(r, ms));

/** How long to wait for a popup to open, and for a selection to be reflected. */
const OPEN_TIMEOUT_MS = 2000;
const COMMIT_TIMEOUT_MS = 1200;
const POLL_MS = 100;

/**
 * A control that opens a list, as declared by the page.
 *
 * Native form controls are excluded: they have their own, better paths, and a
 * `<select>` that happens to carry `role="combobox"` must not be clicked at
 * when it can simply be assigned.
 */
export function isAriaPopupControl(el: Element): boolean {
  if (
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLInputElement
  ) {
    return false;
  }
  const role = el.getAttribute("role");
  const popup = el.getAttribute("aria-haspopup");
  return (
    role === "combobox" ||
    role === "listbox" ||
    popup === "listbox" ||
    popup === "menu" ||
    popup === "true"
  );
}

const OPTION_ROLES = ["radio", "checkbox", "switch"] as const;
const OPTION_SELECTOR = OPTION_ROLES.map((r) => `[role="${r}"]`).join(", ");

/**
 * True for a non-native choice: an individual `role="radio"`/`"checkbox"`/
 * `"switch"`, or the `role="radiogroup"` that holds several of them.
 *
 * Both forms appear in the plan — the group when the page declared one, a bare
 * option when it did not — and either can be handed to the driver.
 */
export function isAriaChoice(el: Element): boolean {
  if (el instanceof HTMLInputElement) return false;
  const role = el.getAttribute("role");
  if (role === "radiogroup") return el.querySelector(OPTION_SELECTOR) !== null;
  return (OPTION_ROLES as readonly string[]).includes(role ?? "");
}

/** Visible text of a node, collapsed. */
const textOf = (el: Element | null | undefined): string =>
  (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/**
 * What the control currently reads as.
 *
 * `aria-activedescendant` is the authoritative answer when present — it names
 * the chosen option by id. Otherwise the control's own rendered text is what a
 * sighted user sees, minus the placeholders that mean "nothing chosen".
 */
export function ariaControlValue(el: Element): string {
  const activeId = el.getAttribute("aria-activedescendant");
  if (activeId) {
    const active = el.ownerDocument.getElementById(activeId);
    if (active) return textOf(active);
  }
  const text = textOf(el);
  return /^(select|select one|select\.\.\.|select…|choose|choose one|-+)$/i.test(text) ? "" : text;
}

/** Every `[role=option]` a popup offers, in DOM order. */
function optionsIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="option"]'));
}

/**
 * The popup this control owns.
 *
 * Searched at document level rather than inside the control, because a popup is
 * as likely to be portalled to the end of `<body>` as to be a child. Three ways
 * to find it, in descending order of how explicitly the page said so:
 * `aria-controls`/`aria-owns` name it outright; otherwise a `[role=listbox]` or
 * `[role=menu]` that was not on the page before the click is the one the click
 * opened.
 */
function findPopup(el: Element, before: ReadonlySet<Element>): HTMLElement | undefined {
  const doc = el.ownerDocument;
  const named = el.getAttribute("aria-controls") ?? el.getAttribute("aria-owns");
  if (named) {
    for (const id of named.split(/\s+/).filter(Boolean)) {
      const node = doc.getElementById(id);
      if (node && optionsIn(node).length > 0) return node;
    }
  }
  const lists = Array.from(doc.querySelectorAll<HTMLElement>('[role="listbox"], [role="menu"]'));
  return lists.find((lb) => !before.has(lb) && optionsIn(lb).length > 0);
}

/** Why a write did not happen, in words the user can act on. */
export interface AriaFillResult {
  ok: boolean;
  reason?: string;
}

/**
 * Answer an ARIA popup control: open it, match an option, click it, and make
 * the page prove the choice took.
 */
export async function fillAriaPopup(el: HTMLElement, value: string): Promise<AriaFillResult> {
  // Never reopen a settled field. A control already showing the wanted answer
  // is done, and clicking it again would close on an unrelated option.
  const current = ariaControlValue(el);
  if (current !== "" && matchOptionValue([{ label: current, value: current }], value) !== null) {
    return { ok: true };
  }

  const doc = el.ownerDocument;
  const before = new Set<Element>(doc.querySelectorAll('[role="listbox"], [role="menu"]'));
  el.click();

  let popup: HTMLElement | undefined;
  for (let i = 0; i < OPEN_TIMEOUT_MS / POLL_MS && !popup; i += 1) {
    await sleepIn(el, POLL_MS);
    popup = findPopup(el, before);
  }
  if (!popup) {
    return { ok: false, reason: "This dropdown didn't open when clicked — choose it yourself." };
  }

  const opts = optionsIn(popup);
  const target = matchOptionValue(
    opts.map((o, idx) => ({ label: textOf(o), value: idx })),
    value,
  );
  const hit = target && typeof target.value === "number" ? opts[target.value] : undefined;
  if (!target || !hit) {
    if (el.getAttribute("aria-expanded") === "true") el.click(); // leave it as we found it
    const shown = opts.slice(0, 4).map(textOf).filter(Boolean).join(", ");
    return {
      ok: false,
      reason: shown
        ? `No option here matches that answer (it offers ${shown}${opts.length > 4 ? ", …" : ""}).`
        : "This dropdown offered no options to choose from.",
    };
  }

  const want = String(target.label ?? "");
  // A real pointer sequence: widgets that listen on mousedown rather than click
  // are common enough that a bare click misses them.
  hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  hit.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
  hit.click();

  for (let i = 0; i < COMMIT_TIMEOUT_MS / POLL_MS; i += 1) {
    // Three ways the page can confirm, any one of which is the page's own word
    // for "this is chosen now".
    if (hit.getAttribute("aria-selected") === "true") return { ok: true };
    if (hit.getAttribute("aria-checked") === "true") return { ok: true };
    const now = ariaControlValue(el);
    if (now !== "" && matchOptionValue([{ label: now, value: now }], want) !== null)
      return { ok: true };
    await sleepIn(el, POLL_MS);
  }
  return {
    ok: false,
    reason: `Clicked "${want}" but the field didn't take it — set it yourself.`,
  };
}

/**
 * The group a non-native option belongs to.
 *
 * `role="radiogroup"` when the page provides one; otherwise the nearest
 * ancestor that contains more than one option of the same role, which is what a
 * group is when nobody labelled it.
 */
export function ariaGroupMembers(el: Element): HTMLElement[] {
  const role = el.getAttribute("role");
  // Handed the group itself: its options are its children.
  if (role === "radiogroup") return Array.from(el.querySelectorAll<HTMLElement>(OPTION_SELECTOR));
  const selector = `[role="${role}"]`;
  const group = el.closest('[role="radiogroup"], [role="group"], fieldset');
  if (group) return Array.from(group.querySelectorAll<HTMLElement>(selector));
  let scope: Element | null = el.parentElement;
  while (scope && scope.querySelectorAll(selector).length < 2) scope = scope.parentElement;
  return Array.from((scope ?? el).querySelectorAll<HTMLElement>(selector));
}

/** The label a non-native option shows. */
export function ariaOptionLabel(el: Element): string {
  return el.getAttribute("aria-label") ?? textOf(el);
}

/**
 * Answer a non-native radio/checkbox by clicking the matching option and then
 * asking the page whether it is checked.
 */
export async function fillAriaChoice(el: HTMLElement, value: string): Promise<AriaFillResult> {
  const members = ariaGroupMembers(el);
  const labels = members.map(ariaOptionLabel);
  const target = matchOptionValue(
    labels.map((l, idx) => ({ label: l, value: idx })),
    value,
  );
  const hit = target && typeof target.value === "number" ? members[target.value] : undefined;
  if (!target || !hit) {
    const shown = labels.filter(Boolean).slice(0, 4).join(", ");
    return {
      ok: false,
      reason: shown
        ? `No choice here matches that answer (it offers ${shown}).`
        : "This control offered no choices to pick from.",
    };
  }
  if (hit.getAttribute("aria-checked") === "true") return { ok: true };
  hit.click();
  for (let i = 0; i < COMMIT_TIMEOUT_MS / POLL_MS; i += 1) {
    if (hit.getAttribute("aria-checked") === "true") return { ok: true };
    await sleepIn(el, POLL_MS);
  }
  return {
    ok: false,
    reason: `Clicked "${String(target.label ?? "")}" but the page didn't record it — set it yourself.`,
  };
}
