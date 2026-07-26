export const COMBOBOX_FILL = "offeros:combobox-fill";
export const COMBOBOX_RESULT = "offeros:combobox-result";

export interface ComboboxFillMsg {
  kind: typeof COMBOBOX_FILL;
  fieldId: string;
  value: string;
}

export interface ComboboxResultMsg {
  kind: typeof COMBOBOX_RESULT;
  fieldId: string;
  ok: boolean;
}

export function isComboboxFillMsg(d: unknown): d is ComboboxFillMsg {
  if (typeof d !== "object" || d === null) return false;
  const m = d as ComboboxFillMsg;
  return m.kind === COMBOBOX_FILL && typeof m.fieldId === "string" && typeof m.value === "string";
}

export function isComboboxResultMsg(d: unknown): d is ComboboxResultMsg {
  if (typeof d !== "object" || d === null) return false;
  const m = d as ComboboxResultMsg;
  return m.kind === COMBOBOX_RESULT && typeof m.fieldId === "string" && typeof m.ok === "boolean";
}

// Multi-value variant for skills tag/typeahead fields: one message carries the
// whole skill list, and the driver loops over it (see skills-fill.ts).
export const SKILLS_FILL = "offeros:skills-fill";
export const SKILLS_RESULT = "offeros:skills-result";

export interface SkillsFillMsg {
  kind: typeof SKILLS_FILL;
  fieldId: string;
  values: string[];
}

export interface SkillsResultMsg {
  kind: typeof SKILLS_RESULT;
  fieldId: string;
  filled: number;
  skipped: number;
}

export function isSkillsFillMsg(d: unknown): d is SkillsFillMsg {
  if (typeof d !== "object" || d === null) return false;
  const m = d as SkillsFillMsg;
  return (
    m.kind === SKILLS_FILL &&
    typeof m.fieldId === "string" &&
    Array.isArray(m.values) &&
    m.values.every((v) => typeof v === "string")
  );
}

export function isSkillsResultMsg(d: unknown): d is SkillsResultMsg {
  if (typeof d !== "object" || d === null) return false;
  const m = d as SkillsResultMsg;
  return (
    m.kind === SKILLS_RESULT &&
    typeof m.fieldId === "string" &&
    typeof m.filled === "number" &&
    typeof m.skipped === "number"
  );
}
