"use client";

import { useEffect, useRef, useState } from "react";
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
  },
  {
    label: "What is your gender?",
    pattern: "What is your gender?",
    patterns: ["What is your gender?", "gender"],
    type: "enum",
    // Standard EEOC gender self-identification categories.
    options: ["Male", "Female", "Non-binary", "Decline to self-identify"],
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
  },
  {
    label: "Are you Hispanic or Latino? (Yes/No)",
    pattern: "Are you Hispanic or Latino?",
    patterns: ["Are you Hispanic or Latino?", "hispanic or latino"],
    type: "enum",
    options: ["Yes", "No"],
  },
  {
    label: "Sexual orientation",
    // The stored pattern keeps the "(mark all that apply)" wording real forms
    // use; only the UI label is shortened, since this control offers one choice
    // plus Other… rather than checkboxes.
    pattern: "Sexual orientation (mark all that apply)",
    patterns: ["Sexual orientation (mark all that apply)", "sexual orientation"],
    type: "enum",
    // The option set voluntary self-ID sections present. Anything outside it
    // goes through Other…, which is also where someone picking more than one
    // writes them.
    options: [
      "Heterosexual / Straight",
      "Gay",
      "Lesbian",
      "Bisexual",
      "Queer",
      "Asexual",
      "Prefer not to say",
    ],
  },
  {
    label: "What are your pronouns?",
    pattern: "What are your pronouns?",
    patterns: ["What are your pronouns?", "pronouns"],
    type: "enum",
    options: [
      "He / Him",
      "She / Her",
      "They / Them",
      "He / They",
      "She / They",
      "Prefer not to say",
    ],
  },
];

/** Sentinel select value that reveals the custom-value text input. */
const OTHER = "__other__";

type RowStatus = "idle" | "saving" | "saved" | "error";

type RowState = {
  value: string;
  entryId: string | null;
  patterns: string[];
  status: RowStatus;
  /** Enum preset in "Other…" custom-value mode (value isn't one of the standard options). */
  other: boolean;
};

function initialRow(): RowState {
  return { value: "", entryId: null, patterns: [], status: "idle", other: false };
}

/** How long a typed custom value settles before it is written. Picking an
 *  option writes immediately — there is nothing to wait for. */
const TYPING_SETTLE_MS = 700;

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
                entry.category === "eeo" &&
                preset.patterns.some((p) => entry.questionPatterns.includes(p)),
            );
            if (match) {
              next[preset.pattern] = {
                value: match.answer,
                entryId: match.id,
                patterns: match.questionPatterns,
                status: "idle",
                other:
                  preset.type === "enum" &&
                  !!preset.options &&
                  !preset.options.includes(match.answer),
              };
              boundRef.current[preset.pattern] = {
                entryId: match.id,
                patterns: match.questionPatterns,
              };
            }
          }
          return next;
        });
      })
      .catch(() => setError("Couldn't load Equal Employment answers."));
  }, []);

  /**
   * The entry each row is bound to, updated the moment a write returns.
   *
   * State cannot serve here: two edits to the same row can overlap, and the
   * second would still read `entryId: null` from a render that has not
   * happened yet — creating a second answer-bank entry for a question that
   * already had one. The ref is written synchronously, and `pending` keeps a
   * row's writes in order so the second one updates what the first created.
   */
  const boundRef = useRef<Record<string, { entryId: string | null; patterns: string[] }>>(
    Object.fromEntries(
      EEO_PRESETS.map((preset) => [preset.pattern, { entryId: null, patterns: [] }]),
    ),
  );
  const pendingRef = useRef<Record<string, Promise<unknown>>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // A typed value still settling when the page goes away would be lost
  // silently, which is the failure an autosaving form must not have.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  /**
   * Write a value, or clear the answer when the value is empty.
   *
   * Clearing has to be possible. A bulk action that no longer exists wrote
   * decline answers to every blank voluntary question, and until now nothing
   * could take them back — the select refused an empty value, so an answer
   * created in one click was permanent. "No saved answer" is also a real
   * choice: it leaves the question blank on the form and lets the user decide
   * on the page, which is the sensible default for a voluntary question.
   */
  const commit = (preset: EeoPreset, value: string) => {
    setRows((r) => ({ ...r, [preset.pattern]: { ...r[preset.pattern]!, status: "saving" } }));
    setError(null);
    const run = async () => {
      const bound = boundRef.current[preset.pattern]!;
      try {
        if (!value.trim()) {
          if (bound.entryId) await api.answers.remove(bound.entryId);
          boundRef.current[preset.pattern] = { entryId: null, patterns: [] };
          setRows((r) => ({
            ...r,
            [preset.pattern]: { ...r[preset.pattern]!, entryId: null, status: "saved" },
          }));
          return;
        }
        // On update, preserve any other patterns already on the shared entry and
        // union in this preset's full variant set. Never truncate to just our own.
        const patterns = bound.entryId
          ? [...new Set([...bound.patterns, ...preset.patterns])]
          : preset.patterns;
        const input = {
          questionPatterns: patterns,
          answer: value,
          type: preset.type,
          category: "eeo" as const,
        };
        const saved = bound.entryId
          ? await api.answers.update(bound.entryId, input)
          : await api.answers.create(input);
        boundRef.current[preset.pattern] = {
          entryId: saved.id,
          patterns: saved.questionPatterns,
        };
        setRows((r) => ({
          ...r,
          [preset.pattern]: {
            ...r[preset.pattern]!,
            entryId: saved.id,
            patterns: saved.questionPatterns,
            status: "saved",
          },
        }));
      } catch {
        setError("Couldn't save that answer. Your other answers are unaffected.");
        setRows((r) => ({ ...r, [preset.pattern]: { ...r[preset.pattern]!, status: "error" } }));
      }
    };
    // Chain behind whatever this row is already writing, so an update can never
    // overtake the create it depends on.
    const prior = pendingRef.current[preset.pattern] ?? Promise.resolve();
    pendingRef.current[preset.pattern] = prior.then(run, run);
  };

  /** A typed custom value: write once typing settles. */
  function setValue(preset: EeoPreset, value: string) {
    setRows((r) => ({ ...r, [preset.pattern]: { ...r[preset.pattern]!, value, status: "idle" } }));
    clearTimeout(timersRef.current[preset.pattern]);
    timersRef.current[preset.pattern] = setTimeout(() => commit(preset, value), TYPING_SETTLE_MS);
  }

  /** A chosen option: nothing to wait for, so write it now. */
  function selectOption(preset: EeoPreset, selected: string) {
    clearTimeout(timersRef.current[preset.pattern]);
    if (selected === OTHER) {
      // Reveal the text box; there is no value to save until something is typed.
      setRows((r) => ({
        ...r,
        [preset.pattern]: { ...r[preset.pattern]!, other: true, status: "idle" },
      }));
      return;
    }
    setRows((r) => ({
      ...r,
      [preset.pattern]: { ...r[preset.pattern]!, other: false, value: selected, status: "idle" },
    }));
    // An empty selection means "forget my answer", which commit handles.
    commit(preset, selected);
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
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end sm:gap-2">
              <LabeledSelect
                label={preset.label}
                value={row.other ? OTHER : row.value}
                onChange={(v) => selectOption(preset, v)}
                options={[
                  // Named for what it does, not for what it is: this option
                  // removes a saved answer, and "Select…" reads like a no-op.
                  { value: "", label: row.entryId ? "— leave blank —" : "Select…" },
                  ...(preset.options ?? []).map((o) => ({ value: o, label: o })),
                  { value: OTHER, label: "Other…" },
                ]}
                className="flex-1"
              />
              {row.other && (
                <LabeledInput
                  label="Custom value"
                  value={row.value}
                  onChange={(v) => setValue(preset, v)}
                  className="flex-1"
                />
              )}
            </div>
            {/* Status, not a control. The row saves itself; this only says what
                happened, and stays a fixed width so a select does not shift
                sideways when the word under it changes. */}
            <span
              aria-live="polite"
              className={`w-16 shrink-0 pb-2 text-caption ${
                row.status === "error" ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {row.status === "saving"
                ? "Saving…"
                : row.status === "saved"
                  ? "Saved"
                  : row.status === "error"
                    ? "Failed"
                    : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
