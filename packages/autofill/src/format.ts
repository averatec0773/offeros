// Format a stored profile value for a specific form field: split a full name
// into the first/last parts a two-field form expects, and give a link the
// scheme a URL input needs. Both are best-effort and locale-light — they cover
// the shapes real resumes overwhelmingly use, not every naming system.

export interface NameParts {
  first: string;
  last: string;
}

// Trailing tokens that are honorific/generational suffixes, not surnames.
const SUFFIXES = new Set([
  "jr",
  "sr",
  "ii",
  "iii",
  "iv",
  "v",
  "phd",
  "md",
  "mba",
  "esq",
  "dds",
  "cpa",
  "jd",
]);

// Lowercase surname particles that bind to the following token as one surname
// ("van der Berg"). Not exhaustive, but covers the common European forms.
const PARTICLES = new Set([
  "van",
  "von",
  "der",
  "den",
  "ter",
  "ten",
  "de",
  "del",
  "della",
  "di",
  "da",
  "du",
  "la",
  "le",
  "lo",
  "dos",
  "das",
  "bin",
  "ibn",
  "al",
  "el",
  "st",
]);

const bare = (token: string) => token.toLowerCase().replace(/\.$/, "");

/** Drop trailing suffix tokens ("Jr.", "III", "PhD"). */
function stripSuffixes(tokens: string[]): string[] {
  let end = tokens.length;
  while (end > 1 && SUFFIXES.has(bare(tokens[end - 1]!))) end--;
  return tokens.slice(0, end);
}

/**
 * Split a full name into first and last parts.
 * - "Last, First Middle" ordering is detected by the comma.
 * - Generational suffixes are stripped.
 * - A surname particle ("van", "de", …) starts the last name and holds it whole.
 * - Otherwise the last token is the surname and any middle tokens are dropped.
 * - A single token is treated as a first name with no surname.
 */
export function splitName(fullName: string): NameParts {
  const raw = fullName.trim().replace(/\s+/g, " ");
  if (!raw) return { first: "", last: "" };

  const comma = raw.indexOf(",");
  if (comma !== -1) {
    const left = raw.slice(0, comma).trim();
    const right = raw.slice(comma + 1).trim();
    // The given-name side may carry a further comma ("Garcia, Maria, Elena") —
    // split on comma or space so the first token never keeps a trailing comma.
    const rightFirst = right.split(/[\s,]+/).filter((t) => t !== "")[0] ?? "";
    // "Last, First [Middle]" ordering — but a comma also introduces a credential
    // or suffix ("Jane Doe, PhD" / "John Smith, Jr."), which is NOT a surname swap.
    if (left && right && !SUFFIXES.has(bare(rightFirst))) {
      return { first: rightFirst, last: left };
    }
    if (left) return splitPlain(left);
  }
  return splitPlain(raw);
}

function splitPlain(name: string): NameParts {
  const tokens = stripSuffixes(name.split(" ").filter((t) => t !== ""));
  if (tokens.length === 0) return { first: "", last: "" };
  if (tokens.length === 1) return { first: tokens[0]!, last: "" };

  let lastStart = tokens.length - 1; // default: surname is the final token
  for (let i = 1; i < tokens.length; i++) {
    if (PARTICLES.has(bare(tokens[i]!))) {
      lastStart = i;
      break;
    }
  }
  return { first: tokens[0]!, last: tokens.slice(lastStart).join(" ") };
}

/** Give a link the scheme a URL input needs; leave already-qualified URLs alone. */
export function normalizeLink(url: string): string {
  const t = url.trim();
  if (!t) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t; // already has a scheme
  return `https://${t}`;
}
