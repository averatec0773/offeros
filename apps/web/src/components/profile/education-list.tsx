"use client";

import { Plus, Trash2 } from "lucide-react";
import type { Education } from "@offeros/core";
import { LabeledInput } from "./fields";

export function emptyEducation(): Education {
  return {
    id: crypto.randomUUID(),
    school: "",
    degree: "",
    field: "",
    gpa: "",
    start: "",
    end: "",
  };
}

/** Controlled card list of education entries. Persistence lives in the parent. */
export function EducationList({
  value,
  onChange,
}: {
  value: Education[];
  onChange: (value: Education[]) => void;
}) {
  function update(id: string, patch: Partial<Education>) {
    onChange(value.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }

  function remove(id: string) {
    onChange(value.filter((entry) => entry.id !== id));
  }

  function add() {
    onChange([...value, emptyEducation()]);
  }

  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 && (
        <p className="text-body text-muted-foreground">No education added yet.</p>
      )}

      {value.map((entry) => (
        <div key={entry.id} className="rounded-xl border border-border bg-background p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabeledInput
              label="School"
              value={entry.school}
              onChange={(v) => update(entry.id, { school: v })}
            />
            <LabeledInput
              label="Degree"
              value={entry.degree}
              onChange={(v) => update(entry.id, { degree: v })}
            />
            <LabeledInput
              label="Field of study"
              value={entry.field}
              onChange={(v) => update(entry.id, { field: v })}
            />
            <LabeledInput
              label="GPA"
              value={entry.gpa ?? ""}
              onChange={(v) => update(entry.id, { gpa: v })}
            />
            <LabeledInput
              label="Start"
              value={entry.start}
              onChange={(v) => update(entry.id, { start: v })}
              placeholder="2019"
            />
            <LabeledInput
              label="End"
              value={entry.end}
              onChange={(v) => update(entry.id, { end: v })}
              placeholder="2023 or Present"
            />
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => remove(entry.id)}
              aria-label="Remove education"
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
        Add education
      </button>
    </div>
  );
}
