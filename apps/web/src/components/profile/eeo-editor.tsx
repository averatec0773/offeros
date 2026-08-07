"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { LabeledInput, LabeledSelect } from "./fields";

export type EeoPreset = {
  /** The question label — shown to the user. */
  label: string;
  /** The bare question text (no parenthetical annotation); primary answer-bank pattern and row key. */
  pattern: string;
  /**
   * All patterns stored on the entry: the full question plus short keyword
   * variants. Matching is whole-word containment of the pattern INSIDE the
   * live question, so a full sentence alone can never hit a terse group label
   * like "Gender" or "Veteran Status" — the short variants are what make
   * real-form labels match.
   */
  patterns: string[];
  type: "enum" | "text";
  options?: string[];
  /**
   * Decline-style answer applied by the one-click defaults action. Only on
   * voluntary self-identification questions; work authorization and visa
   * sponsorship intentionally have none — those need the user's true answer.
   */
  privacyDefault?: string;
};

/**
 * The standard US EEO/compliance question set virtually every
 * Workday/Greenhouse/Lever application collects. `pattern` strips the
 * "(Yes/No)" style annotation since that never appears on a live form; it's
 * only present in `label` because that's the verbatim source text.
 *
 * Four presets (gender, race/ethnicity, veteran status, disability status)
 * carry `options` copied near-verbatim from the standard federal
 * self-identification categories used on real ATS forms — the EEOC's race &
 * ethnicity classification and the OFCCP's three-option veteran/disability
 * self-ID wording (Section 503 / VEVRAA). These are NOT invented option
 * lists; they're the same wording Workday/Greenhouse/Lever forms show.
 */
export const EEO_PRESETS: EeoPreset[] = [
  {
    label: "Are you authorized to work in the US? (Yes/No)",
    pattern: "Are you authorized to work in the US?",
    patterns: [
      "Are you authorized to work in the US?",
      "authorized to work",
      "legally authorized",
      "eligible to work",
      "work authorization",
    ],
    type: "enum",
    options: ["Yes", "No"],
  },
  {
    label: "Do you have a disability?",
    pattern: "Do you have a disability?",
    patterns: ["Do you have a disability?", "disability"],
    type: "enum",
    // Exact OFCCP Form CC-305 (Section 503) disability self-identification wording.
    options: [
      "Yes, I have a disability, or have had one in the past",
      "No, I do not have a disability and have not had one in the past",
      "I do not want to answer",
    ],
    privacyDefault: "I do not want to answer",
  },
  {
    label: "What is your gender?",
    pattern: "What is your gender?",
    patterns: ["What is your gender?", "gender"],
    type: "enum",
    // Standard EEOC gender self-identification categories.
    options: ["Male", "Female", "Non-binary", "Decline to self-identify"],
    privacyDefault: "Decline to self-identify",
  },
  {
    label: "Will you now or in the future require sponsorship for employment visa status? (Yes/No)",
    pattern: "Will you now or in the future require sponsorship for employment visa status?",
    patterns: [
      "Will you now or in the future require sponsorship for employment visa status?",
      "sponsorship",
      "visa status",
    ],
    type: "enum",
    options: ["Yes", "No"],
  },
  {
    label: "Do you identify as LGBTQ+? (Yes/No)",
    pattern: "Do you identify as LGBTQ+?",
    patterns: ["Do you identify as LGBTQ+?", "lgbtq"],
    type: "enum",
    options: ["Yes", "No"],
    privacyDefault: "Prefer not to say",
  },
  {
    label: "Are you a veteran?",
    pattern: "Are you a veteran?",
    patterns: ["Are you a veteran?", "veteran"],
    type: "enum",
    // OFCCP standard protected-veteran self-identification wording (VEVRAA).
    options: [
      "I am not a protected veteran",
      "I identify as one or more of the classifications of a protected veteran",
      "I don't wish to answer",
    ],
    privacyDefault: "I don't wish to answer",
  },
  {
    label: "How would you identify your race?",
    pattern: "How would you identify your race?",
    patterns: ["How would you identify your race?", "race", "ethnicity"],
    type: "enum",
    // Standard EEOC race & ethnicity self-identification categories.
    options: [
      "American Indian or Alaska Native",
      "Asian",
      "Black or African American",
      "Hispanic or Latino",
      "Native Hawaiian or Other Pacific Islander",
      "White",
      "Two or More Races",
      "Decline to self-identify",
    ],
    privacyDefault: "Decline to self-identify",
  },
  {
    label: "Are you Hispanic or Latino? (Yes/No)",
    pattern: "Are you Hispanic or Latino?",
    patterns: ["Are you Hispanic or Latino?", "hispanic or latino"],
    type: "enum",
    options: ["Yes", "No"],
    privacyDefault: "Decline to self-identify",
  },
  {
    label: "Sexual orientation (mark all that apply)",
    pattern: "Sexual orientation (mark all that apply)",
    patterns: ["Sexual orientation (mark all that apply)", "sexual orientation"],
    type: "text",
    privacyDefault: "Prefer not to say",
  },
  {
    label: "What are your pronouns?",
    pattern: "What are your pronouns?",
    patterns: ["What are your pronouns?", "pronouns"],
    type: "text",
    privacyDefault: "Prefer not to say",
  },
];

/** Sentinel select value that reveals the custom-value text input. */
const OTHER = "__other__";

type RowState = {
  value: string;
  entryId: string | null;
  patterns: string[];
  saving: boolean;
  saved: boolean;
  /** Enum preset in "Other…" custom-value mode (value isn't one of the standard options). */
  other: boolean;
};

function initialRow(): RowState {
  return { value: "", entryId: null, patterns: [], saving: false, saved: false, other: false };
}

/**
 * The 10 standard Equal Employment questions, each backed by its own answer-bank
 * entry (`category: "eeo"`) matched by pattern. Self-contained: fetches and
 * persists directly against `api.answers`, independent of the Profile document.
 */
export function EeoEditor() {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(EEO_PRESETS.map((p) => [p.pattern, initialRow()])),
  );
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [appliedCount, setAppliedCount] = useState<number | null>(null);

  useEffect(() => {
    api.answers
      .list()
      .then((entries) => {
        setRows((prev) => {
          const next = { ...prev };
          for (const preset of EEO_PRESETS) {
            const match = entries.find(
              (entry) =>
                entry.category === "eeo" &&
                preset.patterns.some((p) => entry.questionPatterns.includes(p)),
            );
            if (match) {
              next[preset.pattern] = {
                value: match.answer,
                entryId: match.id,
                patterns: match.questionPatterns,
                saving: false,
                saved: false,
                other:
                  preset.type === "enum" &&
                  !!preset.options &&
                  !preset.options.includes(match.answer),
              };
            }
          }
          return next;
        });
      })
      .catch(() => setError("Couldn't load Equal Employment answers."));
  }, []);

  function setValue(pattern: string, value: string) {
    setRows((r) => ({ ...r, [pattern]: { ...r[pattern]!, value, saved: false } }));
  }

  function selectOption(pattern: string, selected: string) {
    if (selected === OTHER) {
      setRows((r) => ({ ...r, [pattern]: { ...r[pattern]!, other: true, saved: false } }));
    } else {
      setRows((r) => ({
        ...r,
        [pattern]: { ...r[pattern]!, other: false, value: selected, saved: false },
      }));
    }
  }

  async function save(preset: EeoPreset) {
    const row = rows[preset.pattern]!;
    if (!row.value.trim()) return;
    setRows((r) => ({ ...r, [preset.pattern]: { ...row, saving: true, saved: false } }));
    setError(null);
    try {
      // On update, preserve any other patterns already on the shared entry and
      // union in this preset's full variant set. Never truncate to just our own.
      const patterns = row.entryId
        ? [...new Set([...row.patterns, ...preset.patterns])]
        : preset.patterns;
      const input = {
        questionPatterns: patterns,
        answer: row.value,
        type: preset.type,
        category: "eeo" as const,
      };
      const saved = row.entryId
        ? await api.answers.update(row.entryId, input)
        : await api.answers.create(input);
      setRows((r) => ({
        ...r,
        [preset.pattern]: {
          value: saved.answer,
          entryId: saved.id,
          patterns: saved.questionPatterns,
          saving: false,
          saved: true,
          other: row.other,
        },
      }));
    } catch {
      setError("Couldn't save that answer.");
      setRows((r) => ({ ...r, [preset.pattern]: { ...row, saving: false } }));
    }
  }

  // One click seeds every voluntary self-ID question that's still blank with a
  // decline-style answer. Never touches rows that already have an entry, and
  // never invents answers for work authorization / sponsorship — those two
  // need the user's true answer and stay highlighted until saved.
  async function applyDefaults() {
    setApplying(true);
    setError(null);
    let applied = 0;
    try {
      for (const preset of EEO_PRESETS) {
        if (!preset.privacyDefault) continue;
        const row = rows[preset.pattern]!;
        if (row.entryId) continue;
        const saved = await api.answers.create({
          questionPatterns: preset.patterns,
          answer: preset.privacyDefault,
          type: preset.type,
          category: "eeo" as const,
        });
        applied += 1;
        setRows((r) => ({
          ...r,
          [preset.pattern]: {
            value: saved.answer,
            entryId: saved.id,
            patterns: saved.questionPatterns,
            saving: false,
            saved: true,
            other:
              preset.type === "enum" && !!preset.options && !preset.options.includes(saved.answer),
          },
        }));
      }
      setAppliedCount(applied);
    } catch {
      setError("Couldn't apply the default answers.");
    } finally {
      setApplying(false);
    }
  }

  const truthNeeded = EEO_PRESETS.filter((p) => !p.privacyDefault && !rows[p.pattern]!.entryId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col">
          <p className="text-body-sm font-medium text-foreground">
            Answer the optional self-identification questions once
          </p>
          <p className="text-caption text-muted-foreground">
            Fills every blank voluntary question with a &ldquo;prefer not to answer&rdquo; response.
            {truthNeeded.length > 0 &&
              " Work authorization and visa sponsorship still need your real answer below."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {appliedCount !== null && (
            <span className="text-caption text-muted-foreground">
              {appliedCount === 0 ? "Nothing to fill." : `Saved ${appliedCount}.`}
            </span>
          )}
          <button
            type="button"
            onClick={applyDefaults}
            disabled={applying}
            className="inline-flex shrink-0 items-center rounded-full bg-primary px-3 py-1.5 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
          >
            {applying ? "Applying…" : "Apply privacy-preserving defaults"}
          </button>
        </div>
      </div>

      {error && <p className="text-caption text-destructive">{error}</p>}

      {EEO_PRESETS.map((preset) => {
        const row = rows[preset.pattern]!;
        return (
          <div
            key={preset.pattern}
            className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-end sm:gap-3"
          >
            {preset.type === "enum" ? (
              <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end sm:gap-2">
                <LabeledSelect
                  label={preset.label}
                  value={row.other ? OTHER : row.value}
                  onChange={(v) => selectOption(preset.pattern, v)}
                  options={[
                    { value: "", label: "Select…" },
                    ...(preset.options ?? []).map((o) => ({ value: o, label: o })),
                    { value: OTHER, label: "Other…" },
                  ]}
                  className="flex-1"
                />
                {row.other && (
                  <LabeledInput
                    label="Custom value"
                    value={row.value}
                    onChange={(v) => setValue(preset.pattern, v)}
                    className="flex-1"
                  />
                )}
              </div>
            ) : (
              <LabeledInput
                label={preset.label}
                value={row.value}
                onChange={(v) => setValue(preset.pattern, v)}
                className="flex-1"
              />
            )}
            <div className="flex items-center gap-2">
              {row.saved && <span className="text-caption text-muted-foreground">Saved.</span>}
              <button
                type="button"
                onClick={() => save(preset)}
                disabled={row.saving}
                className="inline-flex items-center rounded-full bg-primary px-3 py-1.5 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
              >
                {row.saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
