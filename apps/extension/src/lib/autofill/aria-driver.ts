import { matchOptionValue } from "@offeros/autofill";
import { deepQueryAll } from "./deep-query";

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

/**
 * Why a write did not happen, in words the user can act on — or, on a write
 * that landed by a route the user should know about, what that route was.
 */
export interface AriaFillResult {
  ok: boolean;
  reason?: string;
}

/** Input types a person types free text into. */
const TYPEABLE_TYPES = new Set(["", "text", "search", "tel", "email", "url", "number"]);

/**
 * A box inside this control that a person could type into.
 *
 * Not every control that says `role="combobox"` has a list behind it. A real
 * application failed City, State/Province AND Zip/Postal Code with "this
 * dropdown didn't open" — and a postal code is not a dropdown. The page had
 * declared a popup on a wrapper around an ordinary text box, so the popup path
 * was the only path tried, and three fields whose values were sitting right
 * there were handed back to the user.
 *
 * The control itself is never an `<input>`, `<select>` or `<textarea>` —
 * `isAriaPopupControl` excludes those, and a `<select>` in particular must stay
 * excluded here, since typing into one is meaningless and its honest failure is
 * the right answer. So what is searched is the wrapper's own subtree, shadow
 * roots included, for a box that is actually typeable.
 */
export function typeableWithin(el: HTMLElement): HTMLInputElement | HTMLElement | null {
  if (el.isContentEditable) return el;
  for (const node of deepQueryAll(el, "input")) {
    if (!(node instanceof HTMLInputElement)) continue;
    if (node.readOnly || node.disabled) continue;
    if (!TYPEABLE_TYPES.has(node.type.toLowerCase())) continue;
    return node;
  }
  return null;
}

/** Said of a value that got typed in because the list never appeared. */
export const TYPED_TEXT_REASON =
  "This dropdown never opened, so the value was typed in as text — worth a glance.";

/** Set a value the way a framework-controlled box will notice. */
function setTyped(target: HTMLInputElement | HTMLElement, value: string): void {
  if (target instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(target, value);
    else target.value = value;
  } else {
    target.textContent = value;
  }
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
}

const readTyped = (target: HTMLInputElement | HTMLElement): string =>
  target instanceof HTMLInputElement ? target.value : (target.textContent ?? "");

/**
 * Type the value in, and let the page have the last word.
 *
 * The check after the wait is the whole point: a controlled widget that means
 * to own its own value will wipe what was typed a tick later, and reporting
 * that as filled would be the one thing this file exists to avoid.
 */
async function typeAsText(el: HTMLElement, value: string): Promise<boolean> {
  const target = typeableWithin(el);
  if (!target) return false;
  if (target instanceof HTMLInputElement) target.focus();
  setTyped(target, value);
  await sleepIn(el, POLL_MS);
  const got = readTyped(target).trim();
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return got !== "" && squash(got) === squash(value.trim());
}

/**
 * A pointer press, as a browser actually delivers one.
 *
 * `el.click()` dispatches exactly one event: `click`. A real press is a
 * sequence, and widgets choose their own rung of it — opening on `mousedown`
 * is the common choice, because it makes the list appear before the button
 * comes back up. The option-selecting code below has known this for a while
 * ("widgets that listen on mousedown rather than click are common enough that
 * a bare click misses them") while the code that OPENED the popup used the bare
 * click, so a widget listening one rung lower was unreachable however many
 * times it was asked. Three Equal Employment dropdowns on a real application
 * were shut for exactly this reason.
 */
function pressPointer(el: HTMLElement): void {
  const view = el.ownerDocument.defaultView ?? window;
  const init = { bubbles: true, cancelable: true, button: 0, view } as MouseEventInit;
  // PointerEvent first where the environment has it: a widget written against
  // pointer events never sees a MouseEvent.
  const Pointer = (view as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent;
  if (Pointer) {
    el.dispatchEvent(new Pointer("pointerdown", { ...init, pointerId: 1, isPrimary: true }));
  }
  el.dispatchEvent(new MouseEvent("mousedown", init));
  if (Pointer) {
    el.dispatchEvent(new Pointer("pointerup", { ...init, pointerId: 1, isPrimary: true }));
  }
  el.dispatchEvent(new MouseEvent("mouseup", init));
  el.click();
}

/** A key press, both halves of it. */
function pressKey(el: HTMLElement, key: string, altKey = false): void {
  const view = el.ownerDocument.defaultView ?? window;
  const init = { bubbles: true, cancelable: true, key, altKey, view } as KeyboardEventInit;
  el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
}

/**
 * Get the list open, escalating only as far as it has to.
 *
 * A pointer press first, because that is what the user would do. Then the
 * keyboard openers the ARIA combobox pattern specifies — Alt+Down, Down, Enter,
 * Space — which is the interaction a page that supports keyboard users has
 * implemented whether or not its mouse handling is conventional.
 *
 * Each gesture is followed by a wait, and the first one that produces a list
 * wins: a widget that toggles would be closed again by the next gesture, so
 * asking twice when once worked is not thoroughness, it is a bug.
 */
async function openPopup(
  el: HTMLElement,
  before: ReadonlySet<Element>,
): Promise<HTMLElement | undefined> {
  const gestures: (() => void)[] = [
    () => {
      // Focus first: a widget can only receive the keys below if it has focus,
      // and several will not open unfocused either.
      if (typeof el.focus === "function") el.focus();
      pressPointer(el);
    },
    // The two openers the ARIA combobox pattern names, and deliberately ONLY
    // those two. Enter and Space are the other conventional openers and are not
    // sent: both are activation keys, a page is free to treat them as "submit
    // the form", and this application is not ours to send. Arrow keys have no
    // activation meaning anywhere, so the worst a page can do with one is
    // ignore it.
    () => pressKey(el, "ArrowDown"),
    () => pressKey(el, "ArrowDown", true),
  ];

  const perGesture = Math.max(1, Math.floor(OPEN_TIMEOUT_MS / gestures.length / POLL_MS));
  for (const gesture of gestures) {
    gesture();
    for (let i = 0; i < perGesture; i += 1) {
      await sleepIn(el, POLL_MS);
      const popup = findPopup(el, before);
      if (popup) return popup;
    }
  }
  return undefined;
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
  const popup = await openPopup(el, before);
  if (!popup) {
    // No list came. If what is underneath is a text box after all, typing the
    // answer in is better than handing back a field whose value we are holding.
    if (await typeAsText(el, value)) return { ok: true, reason: TYPED_TEXT_REASON };
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
