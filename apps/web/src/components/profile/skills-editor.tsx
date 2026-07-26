"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { inputClass } from "./fields";

/** Controlled tag input: Enter adds a skill, × removes one. Duplicates ignored. */
export function SkillsEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const skill = draft.trim();
    if (!skill) return;
    if (!value.includes(skill)) onChange([...value, skill]);
    setDraft("");
  }

  function remove(skill: string) {
    onChange(value.filter((s) => s !== skill));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      const last = value[value.length - 1];
      if (last !== undefined) remove(last);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((skill) => (
            <li
              key={skill}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-caption font-medium text-secondary-foreground"
            >
              {skill}
              <button
                type="button"
                onClick={() => remove(skill)}
                aria-label={`Remove ${skill}`}
                className="inline-flex size-4.5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={add}
        placeholder="Type a skill and press Enter"
        aria-label="Add a skill"
        className={inputClass}
      />
    </div>
  );
}
