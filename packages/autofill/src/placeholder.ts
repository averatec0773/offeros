/**
 * Telling "nobody has answered this" apart from "somebody has".
 *
 * A control that shows text is not a control that has been answered. A select
 * resting on "-None-", a country picker showing "Select…", a phone field
 * displaying the dial code of the country it defaulted to — all of them read as
 * a value to anything that only asks "is this string empty". Treating them as
 * answered meant an application went out with the applicant's real answers
 * still sitting in their profile while the panel reported every one of those
 * fields as filled, with a green tick and the placeholder as the value.
 *
 * Structure first, words second. Whether a native `<select>` is resting on its
 * placeholder is a fact about the DOM — the selected option's `value` is empty,
 * or the option is disabled — and facts beat guesses. But most ATS dropdowns
 * are not `<select>`s at all: they are divs whose "value" is whatever text is
 * showing, and that text is the only evidence there is. Hence the list below,
 * kept in one place so a new form's wording is one line rather than a hunt, and
 * kept deliberately short: a phrase here overrides a real answer that happens
 * to look like it, so this is not the place to be generous.
 */

/**
 * Words a form shows when nothing has been chosen.
 *
 * Matched against the whole value, never against a substring: "None of the
 * above" is a real answer to a real question, and "Unknown" as one option among
 * several ("Gender: … Unknown") is a real choice a person can make. The whole
 * value being exactly this is what makes it a placeholder.
 */
const PLACEHOLDER_PHRASES: readonly string[] = [
  "",
  "-",
  "--",
  "---",
  "none",
  "-none-",
  "no selection",
  "not selected",
  "unknown",
  "n/a",
  "na",
  "select",
  "select one",
  "select an option",
  "select option",
  "select...",
  "please select",
  "please select one",
  "choose",
  "choose one",
  "choose an option",
  "make a selection",
  "pick one",
  "-- select --",
  "select a value",
  "nothing selected",
];

/** Ellipsis characters and decorative dashes collapse to nothing meaningful. */
function normalizePlaceholder(value: string): string {
  return value
    .toLowerCase()
    .replace(/[…]/g, "...")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-\s*]+|[-\s*:]+$/g, (m) => (m.includes("-") && m.trim().length > 0 ? m : ""))
    .trim();
}

/** True when this text is a form's way of saying "nothing chosen yet". */
export function isPlaceholderText(value: string): boolean {
  const v = normalizePlaceholder(value);
  if (v === "") return true;
  if (PLACEHOLDER_PHRASES.includes(v)) return true;
  // "Select…" / "Select a country" / "Choose your title" — the imperative form
  // is an instruction, not an answer. What follows the verb has to be generic
  // for this to fire: "Select Board Member" is a job somebody holds, and a
  // rule that swallowed it would erase a real answer to keep a placeholder
  // list tidy.
  const imperative = /^(?:please\s+)?(?:select|choose)\b(.*)$/.exec(v);
  if (imperative) {
    const rest = (imperative[1] ?? "").replace(/\.{3}$/, "").trim();
    if (rest === "") return true;
    if (/^(one|an?\s+\w+|your\s+\w+|from\s+(the\s+)?\w+)$/.test(rest)) return true;
  }
  // A row of dashes or dots, whatever its length.
  if (/^[-.·]+$/.test(v)) return true;
  return false;
}

/**
 * A phone field showing only the country it defaulted to.
 *
 * Composite phone controls put a country picker beside the number box, and some
 * of them report the pair as one value: "United States+1", "+1", "🇺🇸 +1". The
 * dial code is the widget's own furniture — nobody typed it as an answer, and
 * the number is still missing. A real number is a run of digits; a dial code is
 * one to four of them at the front.
 */
export function isPlaceholderPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits === "") return true;
  // Strip a leading country code and see whether a number is left. Four digits
  // is shorter than any real subscriber number and long enough that no dial
  // code reaches it.
  const withoutDialCode = /^\+?\d{1,4}$/.test(digits) ? "" : digits;
  return withoutDialCode.length < 4;
}

/**
 * Is the value this control is showing a placeholder rather than an answer?
 *
 * `classifiedType` lets a field say what kind of value it holds; only the phone
 * family needs it today.
 */
export function isPlaceholderValue(value: string, classifiedType?: string): boolean {
  if (classifiedType === "phone" || classifiedType === "tel" || classifiedType === "mobile") {
    return isPlaceholderPhone(value);
  }
  return isPlaceholderText(value);
}

/**
 * Do the page's value and ours say the same thing?
 *
 * Compared on the characters that carry meaning, because a form is free to
 * reformat what it holds — "(555) 123-4567" against "5551234567", "United
 * States" against "United States of America" is NOT the same and is not
 * treated as such. Only reformatting is forgiven, never rewording.
 */
export function valuesAgree(pageValue: string, ourValue: string): boolean {
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = squash(pageValue);
  const b = squash(ourValue);
  if (a === "" || b === "") return false;
  return a === b;
}

/** What the page is doing with a field, as far as anyone can tell from it. */
export type PageValueState =
  /** Nothing there at all. */
  | "empty"
  /** Showing something, but it is the control's own default. */
  | "placeholder"
  /** Holding what we were going to write anyway. */
  | "agrees"
  /** Holding something else. Could be the applicant's typing, could be the
   *  site's own résumé parse — the DOM cannot tell those apart, so neither do
   *  we: both are shown to the applicant and neither is overwritten. */
  | "differs";

export interface PageValueInput {
  /** What the control shows now. */
  currentValue?: string;
  /** Scan-time structural evidence that this is the control's default. */
  currentValueIsPlaceholder?: boolean;
  classifiedType?: string;
}

/** Classify what the page is holding, against what we were going to write. */
export function pageValueState(field: PageValueInput, ourValue: string): PageValueState {
  const current = (field.currentValue ?? "").trim();
  if (current === "") return "empty";
  // The DOM said so outright — no text pattern can outvote that.
  if (field.currentValueIsPlaceholder === true) return "placeholder";
  if (isPlaceholderValue(current, field.classifiedType)) return "placeholder";
  if (valuesAgree(current, ourValue)) return "agrees";
  return "differs";
}
