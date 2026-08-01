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
  | "skills";

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

// mirrors task-mode.ts's isCoverLetterField phrase set; duplicated (not
// imported) because this package must stay DOM-free and extension-independent.
const COVER_LETTER_PHRASES = ["cover letter", "motivation letter", "cover note"];

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

export function classifyField(desc: FieldDescriptor): CanonicalField | null {
  const acField = autocompleteField(desc.autocomplete);
  if (acField) return acField;

  const label = norm([desc.label, desc.ariaLabel, desc.placeholder].filter((s) => s).join(" "));
  if (desc.type === "file" && (label.includes("resume") || label.includes("cv"))) return "resume";
  // cover-letter file kind: guarded to type "file" only, exactly like resume
  // above — a cover-letter *textarea* stays ungoverned by the classifier
  // (task-mode.ts's isCoverLetterField + the paste-verbatim flow own that case).
  if (desc.type === "file" && COVER_LETTER_PHRASES.some((phrase) => label.includes(phrase))) {
    return "coverLetter";
  }
  // long question-like labels ("We would like to contact you via SMS…") must not
  // hit keyword rules built for short field labels; they belong to the answer bank.
  if (label && label.split(" ").length <= 6) {
    for (const rule of LABEL_RULES) {
      if (rule.test(label)) return rule.field;
    }
  }

  const token = norm([desc.name, desc.fieldId].filter((s) => s).join(" "));
  for (const rule of LABEL_RULES) {
    if (token && rule.test(token)) return rule.field;
  }
  return null;
}
