"use client";

import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { AnswerEntry } from "@offeros/core";
import { api } from "@/lib/api-client";
import { LabeledInput, LabeledSelect } from "./fields";

type Draft = {
  questionPatterns: string;
  answer: string;
  type: AnswerEntry["type"];
  category: AnswerEntry["category"];
};

const EMPTY_DRAFT: Draft = { questionPatterns: "", answer: "", type: "text", category: "custom" };

const TYPE_OPTIONS = ["text", "enum", "number", "boolean"].map((v) => ({ value: v, label: v }));
const CATEGORY_OPTIONS = ["custom", "screening", "eeo"].map((v) => ({ value: v, label: v }));

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
 * Full CRUD over the answer bank (any category — EEO entries also show up
 * here since `EeoEditor` writes through the same API). Self-contained: fetches
 * and persists directly against `api.answers`, independent of the Profile document.
 */
export function AnswersEditor() {
  const [entries, setEntries] = useState<AnswerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    api.answers
      .list()
      .then(setEntries)
      .catch(() => setError("Couldn't load answers."));
  }, []);

  async function add() {
    const input = fromDraft(newDraft);
    if (input.questionPatterns.length === 0 || !input.answer.trim()) return;
    setError(null);
    try {
      const created = await api.answers.create(input);
      setEntries((e) => [...(e ?? []), created]);
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
      const updated = await api.answers.update(id, input);
      setEntries((e) => (e ?? []).map((x) => (x.id === id ? updated : x)));
      setEditingId(null);
    } catch {
      setError("Couldn't save the answer.");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api.answers.remove(id);
      setEntries((e) => (e ?? []).filter((x) => x.id !== id));
      setConfirmId(null);
    } catch {
      setError("Couldn't delete the answer.");
    }
  }

  async function addSuggested(question: { pattern: string; type: AnswerEntry["type"] }) {
    setError(null);
    try {
      const created = await api.answers.create({
        questionPatterns: [question.pattern],
        answer: "",
        type: question.type,
        category: "screening",
      });
      setEntries((e) => [...(e ?? []), created]);
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
                label="Question patterns"
                value={editDraft.questionPatterns}
                onChange={(v) => setEditDraft((d) => ({ ...d, questionPatterns: v }))}
                placeholder="Comma-separated, e.g. Salary expectations, Expected salary"
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
            label="New question patterns"
            value={newDraft.questionPatterns}
            onChange={(v) => setNewDraft((d) => ({ ...d, questionPatterns: v }))}
            placeholder="Comma-separated, e.g. Salary expectations, Expected salary"
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
