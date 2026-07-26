import { describe, expect, it } from "vitest";
import { isComboboxFillMsg, isComboboxResultMsg, COMBOBOX_FILL, COMBOBOX_RESULT, isSkillsFillMsg, isSkillsResultMsg, SKILLS_FILL, SKILLS_RESULT } from "../src/lib/autofill/combobox-protocol";

describe("combobox protocol guards", () => {
  it("accepts only well-formed fill messages", () => {
    expect(isComboboxFillMsg({ kind: COMBOBOX_FILL, fieldId: "f1", value: "Yes" })).toBe(true);
    expect(isComboboxFillMsg({ kind: COMBOBOX_FILL, fieldId: "f1" })).toBe(false);
    expect(isComboboxFillMsg({ kind: COMBOBOX_RESULT, fieldId: "f1", ok: true })).toBe(false);
    expect(isComboboxFillMsg(null)).toBe(false);
  });
  it("accepts only well-formed result messages", () => {
    expect(isComboboxResultMsg({ kind: COMBOBOX_RESULT, fieldId: "f1", ok: true })).toBe(true);
    expect(isComboboxResultMsg({ kind: COMBOBOX_RESULT, fieldId: "f1" })).toBe(false);
    expect(isComboboxResultMsg("x")).toBe(false);
  });
});

describe("skills protocol guards", () => {
  it("accepts only well-formed skills fill messages", () => {
    expect(isSkillsFillMsg({ kind: SKILLS_FILL, fieldId: "f1", values: ["C++", "Linux"] })).toBe(true);
    expect(isSkillsFillMsg({ kind: SKILLS_FILL, fieldId: "f1", values: [] })).toBe(true);
    expect(isSkillsFillMsg({ kind: SKILLS_FILL, fieldId: "f1", values: "C++" })).toBe(false);
    expect(isSkillsFillMsg({ kind: SKILLS_FILL, fieldId: "f1" })).toBe(false);
    expect(isSkillsFillMsg({ kind: COMBOBOX_FILL, fieldId: "f1", value: "x" })).toBe(false);
    expect(isSkillsFillMsg(null)).toBe(false);
  });
  it("accepts only well-formed skills result messages", () => {
    expect(isSkillsResultMsg({ kind: SKILLS_RESULT, fieldId: "f1", filled: 3, skipped: 1 })).toBe(true);
    expect(isSkillsResultMsg({ kind: SKILLS_RESULT, fieldId: "f1", filled: 3 })).toBe(false);
    expect(isSkillsResultMsg("x")).toBe(false);
  });
});
