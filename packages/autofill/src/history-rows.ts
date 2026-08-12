import type { FieldDescriptor } from "./classify";
import type { FillEducation, FillExperience, FillProfile } from "./types";

/**
 * Filling a form that asks for a history, not a fact.
 *
 * Most fields have one answer. A repeated section does not: three experience
 * rows want three different jobs, and the row is the only thing that says
 * which. Before this, every row went through the ordinary classifier, which
 * knows about "current employer" and nothing about rows — so an applicant with
 * three jobs had the same company written into all three, and their education
 * table said one school three times.
 *
 * Two jobs here, both pure:
 *
 *   1. work out which repeated section a field belongs to and which row it is
 *      in, from the field alone;
 *   2. hand back the value that row's entry has for it.
 *
 * The row index comes from the DOM order of matching fields rather than from
 * anything the page says about itself, because pages number their rows in every
 * possible way and DOM order is the one thing they all agree on.
 *
 * Nothing here is generated. A row's "Summary" is the applicant's own
 * description of that job, already written and stored — asking a model to
 * invent one when the real one is a lookup away is how a form ends up with a
 * generic paragraph where a specific history belonged.
 */

export type HistoryKind = "education" | "experience";

/** What a repeated row's field is asking for. */
export type HistoryField =
  "school" | "degree" | "fieldOfStudy" | "company" | "title" | "summary" | "start" | "end";

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Which history a label belongs to, and which part of an entry it asks for.
 *
 * Order matters: the more specific phrases come first, so "field of study"
 * cannot be read as a bare "field", and "job title" is a title rather than a
 * courtesy title.
 */
const ROW_RULES: { kind: HistoryKind; field: HistoryField; test: (t: string) => boolean }[] = [
  // Education
  {
    kind: "education",
    field: "school",
    test: (t) =>
      t.includes("school") ||
      t.includes("university") ||
      t.includes("college") ||
      t.includes("institution") ||
      t.includes("institute name"),
  },
  {
    kind: "education",
    field: "fieldOfStudy",
    test: (t) =>
      t.includes("field of study") ||
      t.includes("major") ||
      t.includes("discipline") ||
      t.includes("specialization") ||
      t.includes("specialisation"),
  },
  {
    kind: "education",
    field: "degree",
    test: (t) => t.includes("degree") || t.includes("qualification") || t.includes("course"),
  },
  // Experience
  {
    kind: "experience",
    field: "company",
    test: (t) =>
      t.includes("company") ||
      t.includes("employer") ||
      t.includes("organisation") ||
      t.includes("organization"),
  },
  {
    kind: "experience",
    field: "title",
    test: (t) =>
      t.includes("occupation") ||
      t.includes("job title") ||
      t.includes("designation") ||
      t.includes("position") ||
      t.includes("role title") ||
      t === "title",
  },
  {
    kind: "experience",
    field: "summary",
    test: (t) =>
      t.includes("summary") ||
      t.includes("responsibilities") ||
      t.includes("description of work") ||
      t.includes("job description") ||
      t.includes("duties"),
  },
];

/** Dates belong to whichever history the row is in, so they are matched last. */
const DATE_RULES: { field: HistoryField; test: (t: string) => boolean }[] = [
  {
    field: "start",
    test: (t) =>
      t.includes("start") || t.includes("from date") || t === "from" || t.includes("joined"),
  },
  {
    field: "end",
    test: (t) =>
      t.includes("end") ||
      t.includes("to date") ||
      t === "to" ||
      t.includes("relieved") ||
      t.includes("completion") ||
      t.includes("graduat"),
  },
];

export interface RowFieldMatch {
  kind: HistoryKind;
  field: HistoryField;
}

/**
 * What this field asks for, if it is part of a history at all.
 *
 * `sectionHint` is the name of the repeated section the field sits in, when the
 * page gave one ("Educational Details", "Work Experience"). It decides the
 * history for fields that could belong to either — a bare "Start Date" is an
 * education date inside an education section.
 */
/**
 * A repeated row's fields are NAMED, not asked.
 *
 * "Company", "Occupation / Title", "Field of Study" — a column heading, a
 * handful of words. "Why do you want to work at this company?" contains the
 * word company and is not an employer field; treating it as one would put the
 * applicant's current employer in an essay box.
 */
const MAX_ROW_LABEL_WORDS = 5;

export function matchHistoryField(label: string, sectionHint = ""): RowFieldMatch | null {
  const t = norm(label);
  if (t === "") return null;
  if (t.split(" ").length > MAX_ROW_LABEL_WORDS) return null;
  if (label.includes("?")) return null;
  for (const rule of ROW_RULES) {
    if (rule.test(t)) return { kind: rule.kind, field: rule.field };
  }
  const hint = norm(sectionHint);
  const kind: HistoryKind | null = /educat|academic|qualification|school/.test(hint)
    ? "education"
    : /experien|employ|work history|career/.test(hint)
      ? "experience"
      : null;
  if (!kind) return null;
  for (const rule of DATE_RULES) {
    if (rule.test(t)) return { kind, field: rule.field };
  }
  return null;
}

/** The value one entry has for one part of it. */
export function valueForRow(match: RowFieldMatch, profile: FillProfile, rowIndex: number): string {
  if (match.kind === "education") {
    const entry: FillEducation | undefined = profile.education[rowIndex];
    if (!entry) return "";
    switch (match.field) {
      case "school":
        return entry.school;
      case "degree":
        return entry.degree;
      case "fieldOfStudy":
        return entry.field;
      case "start":
        return entry.start;
      case "end":
        return entry.end;
      default:
        return "";
    }
  }
  const entry: FillExperience | undefined = profile.experience[rowIndex];
  if (!entry) return "";
  switch (match.field) {
    case "company":
      return entry.company;
    case "title":
      return entry.title;
    case "start":
      return entry.start;
    case "end":
      return entry.end;
    case "summary":
      // The applicant's own words about that job. Never generated: the real
      // description is a lookup away, and a model asked for one writes a
      // paragraph that could describe anybody.
      return entry.bullets.filter((b) => b.trim() !== "").join("\n");
    default:
      return "";
  }
}

/**
 * Assign a row index to every history field on the page.
 *
 * Rows are numbered by DOM order within each (history, field) pair: the first
 * "Company" on the page is row 0's company, the second is row 1's. Pages number
 * their rows in every possible way — a hidden index, a name suffix, nothing at
 * all — and DOM order is the one thing they all agree on.
 */
export function assignHistoryRows(
  descriptors: FieldDescriptor[],
  sectionHintFor: (fieldId: string) => string = () => "",
): Map<string, RowFieldMatch & { rowIndex: number }> {
  const counters = new Map<string, number>();
  const out = new Map<string, RowFieldMatch & { rowIndex: number }>();
  for (const desc of descriptors) {
    const label = desc.label || desc.ariaLabel || desc.placeholder || "";
    const match = matchHistoryField(label, sectionHintFor(desc.fieldId));
    if (!match) continue;
    const key = `${match.kind}:${match.field}`;
    const rowIndex = counters.get(key) ?? 0;
    counters.set(key, rowIndex + 1);
    out.set(desc.fieldId, { ...match, rowIndex });
  }
  return out;
}

/**
 * Total years of work, from the dates the applicant recorded.
 *
 * Rounds DOWN and only ever states whole years: "four years and eleven months"
 * is four, because a number on an application is a claim and the low one is the
 * one that cannot be wrong in the applicant's favour. Overlapping jobs are
 * counted once — two roles held at the same time are not eight years of
 * experience.
 *
 * Returns null when the dates cannot carry the claim, which is the honest
 * answer and leaves the field for the user.
 */
export function totalExperienceYears(
  experience: FillExperience[],
  now: Date = new Date(),
): number | null {
  const spans: { from: number; to: number }[] = [];
  for (const job of experience) {
    const from = parseMonth(job.start);
    if (from === null) continue;
    const to = /present|current|now/i.test(job.end) ? now.getTime() : parseMonth(job.end);
    if (to === null || to < from) continue;
    spans.push({ from, to });
  }
  if (spans.length === 0) return null;

  // Merge overlaps: two jobs held at once are one stretch of working life.
  spans.sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.from <= last.to) {
      last.to = Math.max(last.to, span.to);
    } else {
      merged.push({ ...span });
    }
  }
  const ms = merged.reduce((sum, s) => sum + (s.to - s.from), 0);
  const years = Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
  return years >= 0 ? years : null;
}

/** A year, or a month and year, in the shapes a profile actually holds. */
function parseMonth(value: string): number | null {
  const v = value.trim();
  if (v === "") return null;
  const yearOnly = /^(\d{4})$/.exec(v);
  if (yearOnly) return Date.UTC(Number(yearOnly[1]), 0, 1);
  const isoish = /^(\d{4})[-/](\d{1,2})/.exec(v);
  if (isoish) return Date.UTC(Number(isoish[1]), Number(isoish[2]) - 1, 1);
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? null : parsed;
}
