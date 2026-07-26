"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { LabeledInput, LabeledSelect } from "./fields";

export type EeoPreset = {
  /** The question label — shown to the user. */
  label: string;
  /** The bare question text (no parenthetical annotation) stored as the answer-bank pattern. */
  pattern: string;
  type: "enum" | "text";
  options?: string[];
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
    type: "enum",
    options: ["Yes", "No"],
  },
  {
    label: "Do you have a disability?",
    pattern: "Do you have a disability?",
    type: "enum",
    // Exact OFCCP Form CC-305 (Section 503) disability self-identification wording.
    options: [
      "Yes, I have a disability, or have had one in the past",
      "No, I do not have a disability and have not had one in the past",
      "I do not want to answer",
    ],
  },
  {
    label: "What is your gender?",
    pattern: "What is your gender?",
    type: "enum",
    // Standard EEOC gender self-identification categories.
    options: ["Male", "Female", "Non-binary", "Decline to self-identify"],
  },
  {
    label: "Will you now or in the future require sponsorship for employment visa status? (Yes/No)",
    pattern: "Will you now or in the future require sponsorship for employment visa status?",
    type: "enum",
    options: ["Yes", "No"],
  },
  {
    label: "Do you identify as LGBTQ+? (Yes/No)",
    pattern: "Do you identify as LGBTQ+?",
    type: "enum",
    options: ["Yes", "No"],
  },
  {
    label: "Are you a veteran?",
    pattern: "Are you a veteran?",
    type: "enum",
    // OFCCP standard protected-veteran self-identification wording (VEVRAA).
    options: [
      "I am not a protected veteran",
      "I identify as one or more of the classifications of a protected veteran",
      "I don't wish to answer",
    ],
  },
  {
    label: "How would you identify your race?",
    pattern: "How would you identify your race?",
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
  },
  {
    label: "Are you Hispanic or Latino? (Yes/No)",
    pattern: "Are you Hispanic or Latino?",
    type: "enum",
    options: ["Yes", "No"],
  },
  {
    label: "Sexual orientation (mark all that apply)",
    pattern: "Sexual orientation (mark all that apply)",
    type: "text",
  },
  {
    label: "What are your pronouns?",
    pattern: "What are your pronouns?",
    type: "text",
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

  useEffect(() => {
    api.answers
      .list()
      .then((entries) => {
        setRows((prev) => {
          const next = { ...prev };
          for (const preset of EEO_PRESETS) {
            const match = entries.find(
              (entry) =>
                entry.category === "eeo" && entry.questionPatterns.includes(preset.pattern),
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
      // On update, preserve any other patterns already on the shared entry — only add
      // this preset's pattern if it's somehow missing. Never truncate to just our own.
      const patterns = row.entryId
        ? row.patterns.includes(preset.pattern)
          ? row.patterns
          : [...row.patterns, preset.pattern]
        : [preset.pattern];
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

  return (
    <div className="flex flex-col gap-3">
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
