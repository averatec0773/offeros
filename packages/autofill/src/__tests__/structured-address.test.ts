import { describe, expect, it } from "vitest";
import { classifyField, type FieldDescriptor } from "../classify";
import { buildFillPlan } from "../fill-plan";
import type { FillProfile } from "../types";

const d = (partial: Partial<FieldDescriptor>): FieldDescriptor => ({
  fieldId: "f",
  label: "",
  name: "",
  autocomplete: "",
  type: "text",
  placeholder: "",
  ariaLabel: "",
  ...partial,
});

function emptyProfile(): FillProfile {
  return {
    personal: { name: "", email: "", phone: "", address: "", links: {} },
    skills: [],
    answerBank: [],
  };
}

function profileWithAddress(): FillProfile {
  const p = emptyProfile();
  p.personal.address = "123 Main St";
  p.personal.city = "Hillsboro";
  p.personal.state = "Oregon";
  p.personal.country = "United States";
  p.personal.postalCode = "97124";
  return p;
}

describe("classify structured address", () => {
  it("classifies city / state / country / postal fields", () => {
    expect(classifyField(d({ label: "City" }))).toBe("city");
    expect(classifyField(d({ label: "State" }))).toBe("state");
    expect(classifyField(d({ label: "State / Province" }))).toBe("state");
    expect(classifyField(d({ label: "Country" }))).toBe("country");
    expect(classifyField(d({ label: "Zip Code" }))).toBe("postalCode");
    expect(classifyField(d({ label: "Postal Code" }))).toBe("postalCode");
  });

  it("keeps one-line address distinct from the parts", () => {
    expect(classifyField(d({ label: "Street Address" }))).toBe("address");
    expect(classifyField(d({ label: "Mailing Address" }))).toBe("address");
  });

  it("does not misfire on unrelated words", () => {
    expect(classifyField(d({ label: "Statement of purpose" }))).not.toBe("state");
  });
});

describe("fill-plan structured address", () => {
  it("fills each part from the profile", () => {
    const plan = buildFillPlan(
      [d({ label: "City" }), d({ label: "State" }), d({ label: "Country" }), d({ label: "Zip" })],
      profileWithAddress(),
    );
    expect(plan.map((i) => [i.value, i.status])).toEqual([
      ["Hillsboro", "fillable"],
      ["Oregon", "fillable"],
      ["United States", "fillable"],
      ["97124", "fillable"],
    ]);
  });

  it("needs-answer when a part is missing", () => {
    const [item] = buildFillPlan([d({ label: "Country" })], emptyProfile());
    expect(item!.status).toBe("needs-answer");
  });
});
