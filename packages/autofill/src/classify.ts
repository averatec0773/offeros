export interface FieldDescriptor {
  fieldId: string;
  label: string;
  name: string;
  autocomplete: string;
  type: string;
  placeholder: string;
  ariaLabel: string;
  /** Whether the ATS marks this field as required (attribute, aria, or "*" in the label). */
  required?: boolean;
  /** Choice-group descriptors only ("radio-group"/"checkbox-group"): the
   *  visible label of every option, in DOM order. */
  options?: string[];
  /** The control's CURRENT value at scan time (text/select value; for groups
   *  the checked option labels). Lets the panel distinguish "we filled this
   *  earlier and it's still there" from "the page reloaded and it's gone". */
  currentValue?: string;
  /**
   * Structural evidence, gathered at scan time, that `currentValue` is the
   * control's own default rather than an answer: a native `<select>` resting on
   * an option with an empty or disabled value, a choice group with nothing
   * checked. Only the DOM knows this, so it is read where the DOM is and
   * carried here; the panel cannot recover it from the text alone, and for
   * custom dropdowns the text is all there is (see `isPlaceholderText`).
   */
  currentValueIsPlaceholder?: boolean;
  /**
   * The visible text around this field, collected ONLY when the label chain
   * found nothing.
   *
   * A form that never associates a label with a field leaves the engine holding
   * the field's own id. The words a person reads standing in front of that
   * control are right there in the container, and this carries them — to the
   * panel's own display, and to the AI classifier, which was previously handed
   * an id and asked what it meant.
   */
  contextText?: string;
  /**
   * The repeated section this field sits in, when the page named one
   * ("Educational Details", "Work Experience").
   *
   * Only a history row needs it, and only for the fields whose own label does
   * not say which history they belong to: a bare "Start Date" is an education
   * date inside an education section and an employment date inside an
   * employment one.
   */
  sectionName?: string;
}

export type CanonicalField =
  | "fullName"
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "address"
  | "city"
  | "state"
  | "country"
  | "postalCode"
  | "linkedin"
  | "github"
  | "portfolio"
  | "resume"
  | "coverLetter"
  | "skills"
  | "recentCompany"
  | "recentTitle";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// autocomplete tokens are the most reliable signal.
const AUTOCOMPLETE: Record<string, CanonicalField> = {
  email: "email",
  tel: "phone",
  "given-name": "firstName",
  "family-name": "lastName",
  name: "fullName",
  "street-address": "address",
  url: "portfolio",
};

// ordered: more specific phrases first so "first name" beats "name".
const LABEL_RULES: { test: (t: string) => boolean; field: CanonicalField }[] = [
  {
    test: (t) =>
      (t.includes("first") && t.includes("last")) ||
      t.includes("full name") ||
      t.includes("full legal name") ||
      t.includes("legal name"),
    field: "fullName",
  },
  { test: (t) => t.includes("first name") || t === "given name", field: "firstName" },
  {
    test: (t) => t.includes("last name") || t.includes("family name") || t.includes("surname"),
    field: "lastName",
  },
  { test: (t) => t.includes("full name") || t === "name" || t === "your name", field: "fullName" },
  // matches "email" and "e-mail"/"e mail" (norm collapses the separator to a
  // space) as whole words — never the "…e mail…" seam in "Home Mailing Address".
  { test: (t) => /\be ?mail\b/.test(t), field: "email" },
  {
    test: (t) =>
      t.includes("phone") ||
      t.includes("mobile") ||
      t.includes("telephone") ||
      /\bcell\b/.test(t) ||
      t.includes("contact number"),
    field: "phone",
  },
  { test: (t) => t.includes("linkedin"), field: "linkedin" },
  {
    test: (t) =>
      t.includes("recent company") ||
      t.includes("current company") ||
      t.includes("current employer") ||
      t.includes("recent employer") ||
      t === "company" ||
      t === "employer",
    field: "recentCompany",
  },
  {
    test: (t) =>
      t.includes("recent job title") ||
      t.includes("recent title") ||
      t.includes("current job title") ||
      t.includes("current title") ||
      t.includes("current role") ||
      t === "job title" ||
      t === "title",
    field: "recentTitle",
  },
  { test: (t) => t.includes("github"), field: "github" },
  {
    test: (t) =>
      (t.includes("portfolio") || t.includes("website") || t.includes("personal site")) &&
      !t.includes("other"),
    field: "portfolio",
  },
  { test: (t) => t.includes("address") || t.includes("street"), field: "address" },
  { test: (t) => /\bcity\b/.test(t) || /\btown\b/.test(t), field: "city" },
  { test: (t) => /\bstate\b/.test(t) || /\bprovince\b/.test(t), field: "state" },
  { test: (t) => /\bcountry\b/.test(t), field: "country" },
  {
    test: (t) =>
      /\bzip\b/.test(t) ||
      t.includes("postal code") ||
      t.includes("post code") ||
      t.includes("postcode"),
    field: "postalCode",
  },
  { test: (t) => t.includes("resume") || t.includes("cv"), field: "resume" },
  { test: (t) => /\bskills?\b/.test(t), field: "skills" },
];

const COVER_LETTER_PHRASES = ["cover letter", "motivation letter", "cover note"];

/** True when a field label reads like a cover-/motivation-letter free-text box
 *  or file upload. norm()-based (lowercases, collapses non-alphanumerics to a
 *  single space) so "Cover-Letter", "Cover_Letter", and "cover letter" all
 *  match alike — the single source of truth for both this classifier's
 *  cover-letter file kind and the extension's task-mode textarea detection. */
export function isCoverLetterLabel(label: string): boolean {
  const t = norm(label);
  return COVER_LETTER_PHRASES.some((phrase) => t.includes(phrase));
}

// autocomplete may be compound ("section-x shipping home tel") — the field
// token sits at the end, so scan tokens right-to-left for a mapped one.
function autocompleteField(ac: string): CanonicalField | null {
  const tokens = ac.toLowerCase().trim().split(/\s+/).filter(Boolean);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i]!;
    if (token in AUTOCOMPLETE) return AUTOCOMPLETE[token]!;
  }
  return null;
}

// Choice controls (single or grouped): a text-field rule must never touch
// them — "New York City Office" contains "city" but is an option, not a city
// field. Their answers come from the answer bank via the group's question.
const CHOICE_TYPES = new Set(["radio", "checkbox", "radio-group", "checkbox-group"]);

// One signal (label / aria / placeholder) tested on its own — joining them
// used to let a "Type here..." placeholder poison an exact-match rule
// (label "Name" + placeholder → "name type here" ≠ "name"). The 8-word guard
// keeps long question-like sentences with the answer bank, while still
// admitting e.g. "What is your most recent job title?" (7 words).
function ruleMatch(raw: string): CanonicalField | null {
  const t = norm(raw);
  if (!t || t.split(" ").length > 8) return null;
  for (const rule of LABEL_RULES) {
    if (rule.test(t)) return rule.field;
  }
  return null;
}

export function classifyField(desc: FieldDescriptor): CanonicalField | null {
  if (CHOICE_TYPES.has(desc.type)) return null;

  const acField = autocompleteField(desc.autocomplete);
  if (acField) return acField;

  const label = norm([desc.label, desc.ariaLabel, desc.placeholder].filter((s) => s).join(" "));
  if (desc.type === "file" && (label.includes("resume") || label.includes("cv"))) return "resume";
  // cover-letter file kind: guarded to type "file" only, exactly like resume
  // above — a cover-letter *textarea* stays ungoverned by the classifier
  // (task-mode.ts's isCoverLetterField + the paste-verbatim flow own that case).
  if (desc.type === "file" && isCoverLetterLabel(label)) {
    return "coverLetter";
  }

  const bySignal =
    ruleMatch(desc.label) ?? ruleMatch(desc.ariaLabel) ?? ruleMatch(desc.placeholder);
  if (bySignal) return bySignal;

  const token = norm([desc.name, desc.fieldId].filter((s) => s).join(" "));
  for (const rule of LABEL_RULES) {
    if (token && rule.test(token)) return rule.field;
  }
  return null;
}
