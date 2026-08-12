import { deepQueryAll } from "./deep-query";

/**
 * Sections that have no fields until you ask for them.
 *
 * Education and work history are often not a fixed set of inputs but an empty
 * table with an "Add" button: the row does not exist in the DOM until a click
 * creates it. A scan of such a page finds the button and nothing else, so the
 * panel reports a form with no education fields, the user sees nothing amiss,
 * and the application goes in with an empty history.
 *
 * Detection is by shape, not by site. Two signals, and either is enough:
 *
 *   - a control that says it adds something ("Add", "+ Add another", "Add an
 *     entry to the Educational Details section"), which is the accessible name
 *     a screen reader would announce;
 *   - a labelled region containing such a control, which is how these sections
 *     are marked up when they are marked up at all.
 *
 * The count is read from the same accessible name where the page states one
 * ("0 of 10 entries added currently"), because a page that says how many rows
 * it allows should be believed over any guess.
 *
 * Nothing here fills anything. It clicks, waits for the row to appear, and
 * reports what happened — including, honestly, when the row never came.
 */

/** Wording a control uses when its job is to add a row. */
const ADD_PATTERNS = [
  /\badd\b.*\b(entry|entries|row|another|more|item|record)\b/i,
  /\b(add|new)\s+(another|more)\b/i,
  // `add` as a whole word, not the start of "Add-ons" — a hyphen counts as a
  // word boundary, so `\badd\b` alone matches far too much.
  /^\s*\+?\s*add(?:\s|$)/i,
  /(?:^|\s)add\s*\+?\s*$/i,
];

/** "0 of 10 entries added currently" — the page's own statement of its limit. */
const COUNT_PATTERN = /(\d+)\s+of\s+(\d+)\s+entr/i;

export interface RepeaterSection {
  /** The control that adds a row. */
  addButton: HTMLElement;
  /** The section this belongs to, when the page marked one out. */
  region: HTMLElement;
  /** What the page calls it — "Educational Details", when it says. */
  name: string;
  /** Rows already present, as the page reports or as the DOM shows. */
  current: number;
  /** The most rows the page will allow, when it says. */
  max?: number;
}

/** The accessible name of a control: what a screen reader would announce. */
function accessibleName(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim() !== "") return aria.trim();
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text !== "") return text;
  return el.getAttribute("title")?.trim() ?? "";
}

/** Words that talk about rows of a form, as opposed to "Add to favorites". */
const ROW_WORDS =
  /\b(entry|entries|row|rows|another|more|item|record|history|education|experience|employment|reference)\b/i;

function looksLikeAddControl(el: Element): boolean {
  const name = accessibleName(el);
  if (name === "") return false;
  if (!ADD_PATTERNS.some((re) => re.test(name))) return false;
  // "Add to favorites", "Add to calendar" — page furniture that starts with
  // the right word and does the wrong thing. An "add to" is only a row-adder
  // when it also talks about rows ("Add an entry to the Education section").
  if (/\badd\s+to\b/i.test(name) && !ROW_WORDS.test(name)) return false;
  return true;
}

/** closest("form"), but able to step out of shadow roots on the way up. */
function insideForm(el: Element): boolean {
  let node: Node | null = el;
  while (node) {
    if (node instanceof Element && node.tagName === "FORM") return true;
    node = node instanceof ShadowRoot ? node.host : node.parentNode;
  }
  return false;
}

/**
 * The section a control belongs to.
 *
 * A labelled region is the page saying so outright. Failing that, the nearest
 * ancestor that looks like a block rather than a wrapper — bounded, because
 * walking to `<form>` would make every repeater the same section.
 */
function sectionOf(el: HTMLElement): { region: HTMLElement; name: string } {
  const labelled = el.closest<HTMLElement>("[role=region][aria-label], fieldset, section");
  if (labelled) {
    const name =
      labelled.getAttribute("aria-label")?.trim() ??
      labelled.querySelector("legend")?.textContent?.trim() ??
      "";
    return { region: labelled, name };
  }
  return { region: el.parentElement ?? el, name: "" };
}

/** How many rows the page says it has, and allows. */
function countsFrom(name: string): { current?: number; max?: number } {
  const m = COUNT_PATTERN.exec(name);
  if (!m) return {};
  return { current: Number(m[1]), max: Number(m[2]) };
}

/** Controls in a region that could hold a row's values. */
function fieldsIn(region: ParentNode): HTMLElement[] {
  return deepQueryAll(region, "input:not([type=hidden]):not([type=button]), select, textarea")
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    .filter((el) => !(el instanceof HTMLInputElement && el.type === "submit"));
}

/** Which history a section is for, from the name the page gave it. */
export function historyKindOf(sectionName: string): "education" | "experience" | null {
  const t = sectionName.toLowerCase();
  if (/educat|academic|qualification|school|degree/.test(t)) return "education";
  if (/experien|employ|work history|career|previous/.test(t)) return "experience";
  return null;
}

/** Every expandable section on the page. */
export function findRepeaters(root: ParentNode): RepeaterSection[] {
  const controls = deepQueryAll(root, 'button, [role="button"], a[href="#"]')
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
    // Only inside the form. A careers page is full of buttons that start with
    // "Add" and have nothing to do with the application — clicking one is a
    // side effect the user never asked for, even a harmless-looking one.
    .filter(insideForm)
    .filter(looksLikeAddControl);

  const seen = new Set<HTMLElement>();
  const out: RepeaterSection[] = [];
  for (const addButton of controls) {
    const { region, name } = sectionOf(addButton);
    if (seen.has(region)) continue;
    seen.add(region);
    const stated = countsFrom(accessibleName(addButton));
    out.push({
      addButton,
      region,
      name: name || accessibleName(addButton),
      current: stated.current ?? 0,
      ...(stated.max !== undefined ? { max: stated.max } : {}),
    });
  }
  return out;
}

export interface ExpandOutcome {
  /** The section, as the page named it. */
  name: string;
  /** Rows the click actually produced, counted by fields appearing. */
  added: number;
  /** Present when fewer rows appeared than were asked for. */
  reason?: string;
}

const ROW_TIMEOUT_MS = 2000;
const POLL_MS = 100;

/**
 * Add rows to one section, one click at a time.
 *
 * Each click is verified by the fields actually appearing, because a button
 * that does nothing looks exactly like a button that worked until you count.
 * Stops at the page's own stated maximum, and stops the moment a click stops
 * producing a row — asking again after the page has refused is how a loop
 * turns into a hundred clicks on somebody's form.
 */
export async function expandRepeater(
  section: RepeaterSection,
  wanted: number,
): Promise<ExpandOutcome> {
  const doc = section.addButton.ownerDocument;
  const win = doc.defaultView ?? window;
  const sleep = (ms: number) => new Promise((r) => win.setTimeout(r, ms));

  const limit = section.max ?? Number.POSITIVE_INFINITY;
  const target = Math.min(wanted, Math.max(limit - section.current, 0));
  if (target <= 0) {
    return { name: section.name, added: 0, reason: "the page allows no more entries here" };
  }

  let added = 0;
  for (let i = 0; i < target; i += 1) {
    const before = fieldsIn(section.region).length;
    section.addButton.click();

    let grew = false;
    for (let waited = 0; waited < ROW_TIMEOUT_MS && !grew; waited += POLL_MS) {
      await sleep(POLL_MS);
      grew = fieldsIn(section.region).length > before;
    }
    if (!grew) {
      return {
        name: section.name,
        added,
        reason:
          added === 0
            ? "the Add button did not produce a row — add the entries yourself"
            : "the page stopped adding rows before every entry fitted",
      };
    }
    added += 1;
  }
  return { name: section.name, added };
}
