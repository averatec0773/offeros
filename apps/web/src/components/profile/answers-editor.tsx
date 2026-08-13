"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { AnswerEntry } from "@offeros/core";
import { LabeledInput, LabeledSelect } from "./fields";
import type { AnswerBank } from "./use-answer-bank";

type Draft = {
  questionPatterns: string;
  answer: string;
  type: AnswerEntry["type"];
  category: AnswerEntry["category"];
};

const EMPTY_DRAFT: Draft = { questionPatterns: "", answer: "", type: "text", category: "custom" };

const TYPE_OPTIONS = ["text", "enum", "number", "boolean"].map((v) => ({ value: v, label: v }));
// No "eeo": those questions are managed in the Equal Employment section, and
// an entry created here under that category would vanish from this list on the
// next load, which is precisely the confusion this file is being fixed for.
const CATEGORY_OPTIONS = ["custom", "screening"].map((v) => ({ value: v, label: v }));

/**
 * One-click starter entries for common application questions, headed by
 * Expected salary. Clicking a chip creates an entry pre-filled with the
 * question pattern and an empty answer for the user to fill in.
 */
const SUGGESTED_QUESTIONS: { pattern: string; type: AnswerEntry["type"] }[] = [
  { pattern: "Expected salary", type: "text" },
  { pattern: "Notice period", type: "text" },
  { pattern: "Years of experience", type: "text" },
  { pattern: "Why this company", type: "text" },
  { pattern: "Work authorization", type: "text" },
];

function toDraft(entry: AnswerEntry): Draft {
  return {
    questionPatterns: entry.questionPatterns.join(", "),
    answer: entry.answer,
    type: entry.type,
    category: entry.category,
  };
}

function fromDraft(draft: Draft): Omit<AnswerEntry, "id"> {
  return {
    questionPatterns: draft.questionPatterns
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
    answer: draft.answer,
    type: draft.type,
    category: draft.category,
  };
}

/**
 * Full CRUD over the answer bank, minus the Equal Employment questions.
 *
 * Those used to be listed here too — same storage, second front-end — and they
 * looked exactly like duplicates of the section above. A user deleted them from
 * this list to tidy up and destroyed the only copy: the EEO rows went on
 * displaying the old values, so nothing suggested anything was wrong until an
 * application went out with the work-authorization question blank. One set of
 * data, one place to edit it.
 */
export function AnswersEditor({ bank }: { bank: AnswerBank }) {
  // EEO entries are still IN the bank — matching and filling read the whole
  // bank — they are simply not editable from here.
  const entries = bank.entries === null ? null : bank.entries.filter((e) => e.category !== "eeo");
  const [error, setError] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function add() {
    const input = fromDraft(newDraft);
    if (input.questionPatterns.length === 0 || !input.answer.trim()) return;
    setError(null);
    try {
      await bank.save(input);
      setNewDraft(EMPTY_DRAFT);
    } catch {
      setError("Couldn't save the answer.");
    }
  }

  function startEdit(entry: AnswerEntry) {
    setEditingId(entry.id);
    setEditDraft(toDraft(entry));
  }

  async function saveEdit(id: string) {
    const input = fromDraft(editDraft);
    if (input.questionPatterns.length === 0 || !input.answer.trim()) return;
    setError(null);
    try {
      await bank.update(id, input);
      setEditingId(null);
    } catch {
      setError("Couldn't save the answer.");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await bank.remove(id);
      setConfirmId(null);
    } catch {
      setError("Couldn't delete the answer.");
    }
  }

  async function addSuggested(question: { pattern: string; type: AnswerEntry["type"] }) {
    setError(null);
    try {
      await bank.save({
        questionPatterns: [question.pattern],
        answer: "",
        type: question.type,
        category: "screening",
      });
    } catch {
      setError("Couldn't add that starter answer.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-muted-foreground">
        Reusable answers to common application questions — autofill drops these into matching fields
        on ATS forms.
      </p>
      <p className="text-caption text-muted-foreground">
        Equal Employment answers are managed in the section below, not here.
      </p>

      {error && <p className="text-caption text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED_QUESTIONS.filter(
          (q) => !(entries ?? []).some((e) => e.questionPatterns.includes(q.pattern)),
        ).map((q) => (
          <button
            key={q.pattern}
            type="button"
            onClick={() => addSuggested(q)}
            className="rounded-full border border-border px-3 py-1.5 text-caption font-medium text-foreground transition-colors hover:bg-muted"
          >
            {q.pattern}
          </button>
        ))}
      </div>

      {entries !== null && entries.length === 0 && (
        <p className="text-body text-muted-foreground">No answers saved yet.</p>
      )}

      {(entries ?? []).map((entry) =>
        editingId === entry.id ? (
          <div key={entry.id} className="rounded-xl border border-border bg-background p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <LabeledInput
                label="Which questions does this answer?"
                value={editDraft.questionPatterns}
                onChange={(v) => setEditDraft((d) => ({ ...d, questionPatterns: v }))}
                placeholder="Separate with commas, e.g. Expected salary, salary"
                className="sm:col-span-2"
              />
              <LabeledInput
                label="Answer"
                value={editDraft.answer}
                onChange={(v) => setEditDraft((d) => ({ ...d, answer: v }))}
              />
              <LabeledSelect
                label="Type"
                value={editDraft.type}
                onChange={(v) => setEditDraft((d) => ({ ...d, type: v as AnswerEntry["type"] }))}
                options={TYPE_OPTIONS}
              />
              <LabeledSelect
                label="Category"
                value={editDraft.category}
                onChange={(v) =>
                  setEditDraft((d) => ({ ...d, category: v as AnswerEntry["category"] }))
                }
                options={CATEGORY_OPTIONS}
              />
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="rounded-full border border-border px-3 py-1.5 text-caption font-medium text-foreground transition-colors hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => saveEdit(entry.id)}
                className="rounded-full bg-primary px-3 py-1.5 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div
            key={entry.id}
            className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background p-3"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-body font-medium text-foreground">
                {entry.questionPatterns.join(", ")}
              </span>
              <span className="text-body text-muted-foreground">{entry.answer}</span>
              <span className="text-micro text-muted-foreground">
                {entry.type} · {entry.category}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {confirmId === entry.id ? (
                <>
                  <span className="text-caption text-muted-foreground">Delete?</span>
                  <button
                    type="button"
                    onClick={() => remove(entry.id)}
                    className="rounded-full bg-destructive/10 px-3 py-1.5 text-caption font-semibold text-destructive transition-colors hover:bg-destructive/20"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className="rounded-full border border-border px-3 py-1.5 text-caption font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => startEdit(entry)}
                    aria-label="Edit answer"
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="size-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(entry.id)}
                    aria-label="Delete answer"
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ),
      )}

      <div className="rounded-xl border border-dashed border-border p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LabeledInput
            label="Which questions will this answer?"
            value={newDraft.questionPatterns}
            onChange={(v) => setNewDraft((d) => ({ ...d, questionPatterns: v }))}
            placeholder="Separate with commas, e.g. Expected salary, salary"
            className="sm:col-span-2"
          />
          <LabeledInput
            label="New answer"
            value={newDraft.answer}
            onChange={(v) => setNewDraft((d) => ({ ...d, answer: v }))}
          />
          <LabeledSelect
            label="New type"
            value={newDraft.type}
            onChange={(v) => setNewDraft((d) => ({ ...d, type: v as AnswerEntry["type"] }))}
            options={TYPE_OPTIONS}
          />
          <LabeledSelect
            label="New category"
            value={newDraft.category}
            onChange={(v) => setNewDraft((d) => ({ ...d, category: v as AnswerEntry["category"] }))}
            options={CATEGORY_OPTIONS}
          />
        </div>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={add}
            className="inline-flex w-fit items-center rounded-full border border-border bg-background px-3 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Add answer
          </button>
        </div>
      </div>
    </div>
  );
}
