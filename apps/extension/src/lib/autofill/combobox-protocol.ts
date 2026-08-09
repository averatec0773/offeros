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

// Field metadata: the isolated world asks the MAIN world to annotate the page
// with what the ATS says about its own fields, because `__reactFiber$` is
// invisible from an isolated world. The reply carries only a count — the data
// itself travels through the DOM, which both worlds share.
export const READ_META = "offeros:read-meta";
export const READ_META_RESULT = "offeros:read-meta-result";

export interface ReadMetaMsg {
  kind: typeof READ_META;
  selector: string;
  nonce: number;
}

export interface ReadMetaResultMsg {
  kind: typeof READ_META_RESULT;
  described: number;
  nonce: number;
}

export function isReadMetaMsg(d: unknown): d is ReadMetaMsg {
  if (typeof d !== "object" || d === null) return false;
  const m = d as ReadMetaMsg;
  return m.kind === READ_META && typeof m.selector === "string" && typeof m.nonce === "number";
}

export function isReadMetaResultMsg(d: unknown): d is ReadMetaResultMsg {
  if (typeof d !== "object" || d === null) return false;
  const m = d as ReadMetaResultMsg;
  return (
    m.kind === READ_META_RESULT && typeof m.described === "number" && typeof m.nonce === "number"
  );
}
