"use client";

import { Plus, Trash2, X } from "lucide-react";
import type { Experience } from "@offeros/core";
import { LabeledInput, inputClass } from "./fields";

export function emptyExperience(): Experience {
  return {
    id: crypto.randomUUID(),
    company: "",
    title: "",
    start: "",
    end: "",
    bullets: [],
  };
}

/** Controlled card list of work-experience entries. Persistence lives in the parent. */
export function ExperienceList({
  value,
  onChange,
}: {
  value: Experience[];
  onChange: (value: Experience[]) => void;
}) {
  function update(id: string, patch: Partial<Experience>) {
    onChange(value.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }

  function remove(id: string) {
    onChange(value.filter((entry) => entry.id !== id));
  }

  function add() {
    onChange([...value, emptyExperience()]);
  }

  function updateBullet(entry: Experience, index: number, text: string) {
    const bullets = entry.bullets.map((b, i) => (i === index ? text : b));
    update(entry.id, { bullets });
  }

  function addBullet(entry: Experience) {
    update(entry.id, { bullets: [...entry.bullets, ""] });
  }

  function removeBullet(entry: Experience, index: number) {
    update(entry.id, { bullets: entry.bullets.filter((_, i) => i !== index) });
  }

  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 && (
        <p className="text-body text-muted-foreground">No work experience added yet.</p>
      )}

      {value.map((entry) => (
        <div key={entry.id} className="rounded-xl border border-border bg-background p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabeledInput
              label="Company"
              value={entry.company}
              onChange={(v) => update(entry.id, { company: v })}
            />
            <LabeledInput
              label="Title"
              value={entry.title}
              onChange={(v) => update(entry.id, { title: v })}
            />
            <LabeledInput
              label="Start"
              value={entry.start}
              onChange={(v) => update(entry.id, { start: v })}
              placeholder="Jan 2022"
            />
            <LabeledInput
              label="End"
              value={entry.end}
              onChange={(v) => update(entry.id, { end: v })}
              placeholder="Present"
            />
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <span className="text-caption font-medium text-muted-foreground">Highlights</span>
            {entry.bullets.map((bullet, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={bullet}
                  onChange={(e) => updateBullet(entry, i, e.target.value)}
                  placeholder="Shipped …"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => removeBullet(entry, i)}
                  aria-label="Remove highlight"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addBullet(entry)}
              className="inline-flex w-fit items-center gap-1 rounded-lg px-2 py-1 text-caption font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Plus className="size-4" />
              Add highlight
            </button>
          </div>

          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => remove(entry.id)}
              aria-label="Remove experience"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-4" />
              Remove
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
      >
        <Plus className="size-4" strokeWidth={2.5} />
        Add experience
      </button>
    </div>
  );
}
