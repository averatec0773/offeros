/**
 * Telling a label from a leftover.
 *
 * Label extraction has always had a fallback chain, and a chain is only as
 * honest as its willingness to say "still nothing". The old one had none: the
 * first non-empty string it found became the field's name, whatever it was. On
 * a real application form that produced a panel listing `rec-form_682152000000063542`,
 * `-None-`, `Loading` and `No Results Found` as though they were questions —
 * and the AI fallback classifier, handed those, correctly placed zero of them.
 * It was not wrong. It was told nothing.
 *
 * So each rung of the chain now has to produce something that could plausibly
 * be a question a person was asked. What follows is the test for that. It is
 * deliberately a pure function over a string: it knows nothing about the DOM,
 * runs the same in the extension and in the offline replay harness, and every
 * rule in it is one line to read.
 *
 * The bias is toward rejecting. A rejected label costs one more rung of the
 * chain, and at the end of the chain the field goes to the classifier with its
 * surrounding text instead. A trusted-but-wrong label costs the user a form
 * filled from a question nobody asked.
 */

/**
 * Words a widget shows while it is thinking, or when it has nothing.
 *
 * These are not labels; they are states. They appear inside dropdowns mid-fetch
 * and in empty select placeholders, and a scan that catches one has caught the
 * page at a moment, not a question. Matched whole (after trimming punctuation)
 * so that a real question containing the word "loading" — "Have you experience
 * with load testing?" — is untouched.
 */
const TRANSIENT_TEXTS = [
  "loading",
  "loading...",
  "loading…",
  "please wait",
  "no results found",
  "no results",
  "no matches found",
  "no options",
  "none",
  "select",
  "select one",
  "select an option",
  "choose",
  "choose one",
  "search",
  "n/a",
  "--",
  "---",
];

/** `-None-`, `— None —`, `[none]` — the same nothing, dressed differently. */
function stripDecoration(text: string): string {
  return text
    .replace(/[‐-―]/g, "-")
    .replace(/^[\s\-–—*_[\](){}:.,|]+/, "")
    .replace(/[\s\-–—*_[\](){}:.,|]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when the text is a widget state rather than a question. */
export function isTransientText(text: string): boolean {
  const t = stripDecoration(text);
  if (t === "") return true;
  return TRANSIENT_TEXTS.includes(t);
}

/**
 * True when the text reads like something a machine named, not something a
 * person was asked.
 *
 * Three shapes, each seen on a real form:
 *   - `rec-form_682152000000063542` — a prefix and a long number,
 *   - `firstNameInput` — one camelCase token with no spaces,
 *   - `682152000000063542` — digits alone.
 *
 * A question has words in it. That is really the whole rule: the tests below
 * are the specific ways of not having any.
 */
export function looksLikeIdentifier(text: string): boolean {
  const t = text.trim();
  if (t === "") return true;
  // Anything with a space and a letter is prose enough to keep.
  const hasSpace = /\s/.test(t);
  if (hasSpace) {
    // …unless every "word" is itself an identifier, which happens when a label
    // is really two ids side by side.
    return t.split(/\s+/).every((word) => word.length > 0 && looksLikeIdentifier(word));
  }
  if (/^\d+$/.test(t)) return true; // bare digits
  // A single token carrying a long run of digits is an id, not a question.
  if (/\d{5,}/.test(t)) return true;
  // A single token joined by machine separators: rec-form_x, field.name.first.
  if (/^[A-Za-z0-9]+([._-][A-Za-z0-9]+)+$/.test(t)) return true;
  // A lone camelCase / snakeless token: firstName, emailAddress.
  if (/^[a-z]+[A-Z][A-Za-z]*$/.test(t)) return true;
  // A lone word is a weak but real label ("Email", "Phone"), so it stays.
  return false;
}

/**
 * Words that name a control's ROLE rather than its question.
 *
 * These arrive when the ladder falls back to a field's `name` attribute and the
 * page called it something generic. `value`, `input`, `field` — each passes
 * every other test here (it is a word, a person could read it, it is not a
 * widget state) and tells the user nothing whatsoever. Seen on a real form as
 * the label of several different questions at once, which is the giveaway: a
 * label that fits every field identifies none.
 *
 * Only rejected when the whole label is one of them. "Field of study" and
 * "Current value of your portfolio" are real questions.
 */
const GENERIC_NAMES = [
  "value",
  "values",
  "input",
  "inputs",
  "field",
  "fields",
  "text",
  "textbox",
  "data",
  "item",
  "entry",
  "answer",
  "question",
  "label",
  "name", // "Name" alone is ambiguous on a form that also asks first/last
  "title",
  "type",
  "option",
  "options",
  "form",
  "content",
  "detail",
  "details",
  "info",
  "information",
];

/** True when the text names a control's role rather than asking anything. */
export function isGenericName(text: string): boolean {
  return GENERIC_NAMES.includes(stripDecoration(text));
}

/** Longest a label can be before it is a paragraph that swallowed a control. */
const MAX_LABEL_CHARS = 200;

/**
 * The one question the extraction chain asks of every rung: is this a label?
 *
 * `false` means "keep looking" — never "give up". The chain's last rung hands
 * the field to the classifier with its surrounding text, which is a better
 * answer than a confident wrong one.
 */
export function isUsableLabel(text: string | null | undefined): boolean {
  if (typeof text !== "string") return false;
  const t = text.replace(/\s+/g, " ").trim();
  if (t === "" || t.length > MAX_LABEL_CHARS) return false;
  if (isTransientText(t)) return false;
  if (isGenericName(t)) return false;
  if (looksLikeIdentifier(t)) return false;
  return true;
}

/**
 * A stricter bar than `isUsableLabel`, for text that arrives as an attribute
 * value rather than as visible content.
 *
 * A component's own props are a rich source of labels — `cx-prop-label`,
 * `data-label`, `lt-prop-label` — and also a rich source of things that are not
 * labels at all: template expressions, ids, booleans, JSON. Visible text has
 * already been through a designer; an attribute value has not. So on top of
 * every rule `isUsableLabel` applies, this one also requires the value to read
 * like something written for a person: at least one letter, and none of the
 * punctuation that means it is markup or code.
 */
export function looksLikeHumanLabel(text: string | null | undefined): boolean {
  if (!isUsableLabel(text)) return false;
  const t = (text as string).trim();
  if (!/[A-Za-z]/.test(t)) return false;
  // Template expressions and code, not prose: {{x}}, ${x}, <b>, a();
  if (/[{}<>$`|]/.test(t)) return false;
  if (/\b(true|false|null|undefined)\b/i.test(t)) return false;
  return true;
}

/**
 * A field that is a CAPTCHA, and therefore permanently the user's.
 *
 * This is a discipline, not a limitation. OfferOS could not read one of these
 * and will not try; there is no path here that calls a solving service, and
 * there should never be one. A CAPTCHA is a site asking whether a person is
 * present, and answering it on the user's behalf would be lying to the employer
 * on their behalf. It goes on the list of fields that are theirs, labelled as
 * what it is, and the fill moves on.
 */
const CAPTCHA_PATTERNS =
  // "IF you are a human, type ALAN below" — the same check as "are you human",
  // phrased as a condition rather than a question. Met on a real application,
  // where the AI answering lane obligingly typed the word.
  //
  // Both word orders, because forms use both: "ARE YOU a human" as a question,
  // "prove YOU ARE a human" as an instruction. And "human resources" is
  // excluded outright — "Are you a Human Resources professional?" is a real
  // question on real applications, and a guard that swallows it hands the
  // applicant back their own job title to type in by hand.
  /captcha|recaptcha|hcaptcha|turnstile|(?:are you|you are)\s+(?:a\s+)?human(?!\s*(?:resources?|capital|factors))\b|type (the )?(below )?image text|enter the (characters|text|code) (you see|shown|above|below)|security check|i'?m not a robot|verification code shown/i;

export function looksLikeCaptcha(subject: {
  label?: string;
  name?: string;
  id?: string;
  containerText?: string;
}): boolean {
  const haystack = [subject.label, subject.name, subject.id, subject.containerText]
    .filter((s): s is string => typeof s === "string" && s !== "")
    .join(" ");
  return CAPTCHA_PATTERNS.test(haystack);
}

/** What the user is told about a CAPTCHA field. Named so both ends say it identically. */
export const CAPTCHA_REASON =
  "This is a CAPTCHA — proving a person is here is yours to do, and OfferOS will not do it for you.";
