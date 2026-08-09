/**
 * What an ATS says about its own fields.
 *
 * Classification has always worked the same way here: read a control's label,
 * name and placeholder off the DOM and infer what it is. That inference is the
 * source of most fill failures, and it fails worst exactly where it matters —
 * a choice group's options each look like their own question, so a 24-question
 * Ashby form scanned as 73 fields and its EEO block arrived as eight unrelated
 * unknowns.
 *
 * But the page already knows. Every major ATS keeps a machine-readable
 * description of each field somewhere reachable, in one of three forms:
 *
 *   - React props holding the field definition (Ashby: `props.field`,
 *     Greenhouse: the props themselves, Workday: `props.property`)
 *   - a semantic id path (`name--legalName--firstName`, `address--city`)
 *   - a stable automation hook (`data-automation-id`)
 *
 * Reading that turns classification from a guess into a lookup, and grouping
 * from DOM-proximity guesswork into "same field id, same question". This module
 * is the vocabulary translation only: raw strings in, our types out. Getting the
 * data off the page is the extension's job (it needs the MAIN world); deciding
 * what the data means is pure, and lives here so it can be tested without a
 * browser.
 */

/** How a field's identity was established, kept for the decision trace. */
export type MetaSource = "props" | "semantic-id" | "automation-id";

/** One field as the ATS itself describes it. */
export interface FieldMeta {
  /** The question, in the words the ATS stores — not scraped from the page. */
  question: string;
  /** Our control vocabulary, translated from the platform's. */
  control: MetaControl;
  /** Controls sharing this belong to ONE question. The whole point: a radio
   *  set or a checkbox block collapses by identity rather than by proximity. */
  groupId: string;
  required: boolean;
  /** Present when the platform enumerates the choices itself. */
  options?: string[];
  source: MetaSource;
}

export type MetaControl =
  | "text"
  | "long-text"
  | "email"
  | "phone"
  | "number"
  | "date"
  | "boolean"
  | "single-select"
  | "multi-select"
  | "location"
  | "file"
  | "unknown";

/**
 * Platform type vocabularies, mapped to ours.
 *
 * Every entry was read off a live application form (see
 * docs/research/2026-08-09-field-metadata-probe.md), not guessed from docs. An
 * unknown string is deliberately NOT an error: platforms add types, and a field
 * we cannot name is better handled by the existing heuristics than by refusing
 * to scan the page.
 */
const CONTROL_VOCABULARY: Record<string, MetaControl> = {
  // Ashby — props.field.type
  String: "text",
  LongText: "long-text",
  Email: "email",
  Phone: "phone",
  Number: "number",
  Date: "date",
  Boolean: "boolean",
  ValueSelect: "single-select",
  MultiValueSelect: "multi-select",
  Location: "location",
  File: "file",
  // Greenhouse — flat props.type
  input_text: "text",
  input_file: "file",
  textarea: "long-text",
  select: "single-select",
  multi_select: "multi-select",
  tel: "phone",
  // Workday — props.property.type
  boolean: "boolean",
  text: "text",
  date: "date",
  monikerList: "single-select",
  multiselectlist: "multi-select",
};

export function toControl(platformType: string): MetaControl {
  return (
    CONTROL_VOCABULARY[platformType] ?? CONTROL_VOCABULARY[platformType.toLowerCase()] ?? "unknown"
  );
}

/**
 * Workday names standard fields by path instead of describing them: an id like
 * `name--legalName--firstName` IS the answer, and reading it beats reading the
 * visible label (which is localised, and decorated with "*").
 *
 * Only the last meaningful segment matters — `name--legalName--firstName` and
 * `name--preferredName--firstName` are both a first name, and the distinction
 * between them is not one the fill engine acts on.
 */
const SEMANTIC_ID_VOCABULARY: Record<string, { question: string; control: MetaControl }> = {
  firstname: { question: "First name", control: "text" },
  lastname: { question: "Last name", control: "text" },
  middlename: { question: "Middle name", control: "text" },
  addressline1: { question: "Address line 1", control: "text" },
  addressline2: { question: "Address line 2", control: "text" },
  city: { question: "City", control: "text" },
  postalcode: { question: "Postal code", control: "text" },
  countryregion: { question: "State or region", control: "single-select" },
  country: { question: "Country", control: "single-select" },
  phonenumber: { question: "Phone number", control: "phone" },
  countryphonecode: { question: "Phone country code", control: "single-select" },
  extension: { question: "Phone extension", control: "text" },
  phonetype: { question: "Phone type", control: "single-select" },
  email: { question: "Email", control: "email" },
  source: { question: "How did you hear about us?", control: "single-select" },
};

/**
 * Read a Workday-style semantic id. Returns null for anything that is not one,
 * which includes every id that merely happens to contain "--".
 */
export function fromSemanticId(id: string): Omit<FieldMeta, "groupId" | "required"> | null {
  if (!id.includes("--")) return null;
  const segments = id.split("--").filter(Boolean);
  const last = segments.at(-1);
  if (!last) return null;
  const hit = SEMANTIC_ID_VOCABULARY[last.toLowerCase()];
  if (!hit) return null;
  return { question: hit.question, control: hit.control, source: "semantic-id" };
}

/** The raw shape the extension scrapes out of a page, before translation. */
export interface RawFieldMeta {
  question?: string;
  platformType?: string;
  groupId?: string;
  required?: boolean;
  options?: string[];
  semanticId?: string;
  source: MetaSource;
}

/**
 * Translate one scraped record. Returns null when there is not enough to be
 * useful — a record with no question and no recognised id tells us nothing the
 * heuristics did not already know, and passing it on would replace a good guess
 * with an empty label.
 */
export function toFieldMeta(raw: RawFieldMeta): FieldMeta | null {
  if (raw.source === "semantic-id" && raw.semanticId) {
    const named = fromSemanticId(raw.semanticId);
    if (!named) return null;
    return {
      ...named,
      groupId: raw.groupId ?? raw.semanticId,
      required: raw.required ?? false,
      ...(raw.options?.length ? { options: raw.options } : {}),
    };
  }
  const question = raw.question?.trim();
  if (!question) return null;
  return {
    question,
    control: toControl(raw.platformType ?? ""),
    // Falling back to the question text is right: two controls the platform
    // describes with the same question ARE the same question, whether or not it
    // gave them a shared id.
    groupId: raw.groupId ?? question,
    required: raw.required ?? false,
    source: raw.source,
    ...(raw.options?.length ? { options: raw.options } : {}),
  };
}

/**
 * Collapse scraped records into one entry per question.
 *
 * This is the function that fixes the counting: eight checkboxes describing
 * "Race" arrive as eight records and leave as one. Options are unioned in
 * document order because a platform that names its choices individually
 * (Workday, Greenhouse checkbox blocks) never repeats the full list on each
 * control, while one that does (Ashby) repeats it identically.
 */
export function groupFieldMeta<T>(
  entries: { meta: FieldMeta; el: T }[],
): { meta: FieldMeta; members: T[] }[] {
  const out = new Map<string, { meta: FieldMeta; members: T[] }>();
  for (const { meta, el } of entries) {
    const existing = out.get(meta.groupId);
    if (!existing) {
      out.set(meta.groupId, { meta: { ...meta }, members: [el] });
      continue;
    }
    existing.members.push(el);
    // A group is required if the platform marks any of its controls required.
    existing.meta.required ||= meta.required;
    if (meta.options?.length) {
      const merged = new Set([...(existing.meta.options ?? []), ...meta.options]);
      existing.meta.options = [...merged];
    }
  }
  return [...out.values()];
}
