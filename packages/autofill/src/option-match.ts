import { geoCandidates } from "./geo-synonyms";

export interface SelectOption {
  label?: unknown;
  value?: unknown;
  options?: SelectOption[];
}

export function flattenOptions(options: SelectOption[]): SelectOption[] {
  return options.flatMap((o) => (Array.isArray(o.options) ? flattenOptions(o.options) : [o]));
}

const text = (o: SelectOption) =>
  String(o.label ?? o.value ?? "")
    .trim()
    .toLowerCase();

// Punctuation/whitespace-insensitive form: "E‑mail address" and "E-mail address"
// both become "e mail address".
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Workday (and other ATS) clip long option labels with an ellipsis. Treat an
// option as a match when the visible fragments appear, in order, inside the
// wanted value — with a length floor so a stub like "Y…" can't match anything.
function ellipsisMatch(optionText: string, wantNorm: string): boolean {
  if (!/…|\.\.\./.test(optionText)) return false;
  const segments = optionText
    .split(/…|\.\.\./)
    .map(norm)
    .filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  if (segments.join("").replace(/ /g, "").length < 6) return false;
  let from = 0;
  for (const seg of segments) {
    const idx = wantNorm.indexOf(seg, from);
    if (idx === -1) return false;
    from = idx + seg.length;
  }
  return true;
}

export function matchOption(options: SelectOption[], want: string): SelectOption | null {
  const wRaw = want.trim().toLowerCase();
  if (wRaw === "") return null;
  const wNorm = norm(want);
  const flat = flattenOptions(options);
  return (
    flat.find((o) => text(o) === wRaw) ?? // exact
    flat.find((o) => norm(text(o)) === wNorm) ?? // punctuation-insensitive exact
    flat.find((o) => ellipsisMatch(text(o), wNorm)) ?? // truncated label
    flat.find((o) => text(o).includes(wRaw)) ?? // substring
    null
  );
}

/**
 * Like matchOption, but if the value doesn't match directly, tries its
 * country/US-state synonyms (e.g. "US" → "United States of America", "Oregon"
 * ↔ "OR"). Non-geo values behave exactly like matchOption.
 */
export function matchOptionValue(options: SelectOption[], want: string): SelectOption | null {
  const direct = matchOption(options, want);
  if (direct) return direct;
  for (const candidate of geoCandidates(want)) {
    const hit = matchOption(options, candidate);
    if (hit) return hit;
  }
  return null;
}
