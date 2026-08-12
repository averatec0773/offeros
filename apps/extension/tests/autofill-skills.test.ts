import { describe, expect, it } from "vitest";
import { matchAts } from "../src/lib/autofill/recipes";
import {
  classifyField,
  buildFillPlan,
  type FieldDescriptor,
  type FillProfile,
} from "@offeros/autofill";

const desc = (d: Partial<FieldDescriptor>): FieldDescriptor => ({
  fieldId: "f",
  label: "",
  name: "",
  autocomplete: "",
  type: "text",
  placeholder: "",
  ariaLabel: "",
  ...d,
});

function withSkills(skills: string[]): FillProfile {
  return {
    personal: {
      name: "",
      email: "",
      phone: "",
      address: "",
      links: {},
    },
    skills,
    answerBank: [],
    education: [],
    experience: [],
  };
}

describe("myworkday recipe", () => {
  it("matches a real Workday external host", () => {
    expect(matchAts("https://intel.wd1.myworkdayjobs.com/External/job/x/apply")?.atsId).toBe(
      "myworkday",
    );
  });

  it("does not match the unrelated jobs.workday.com host", () => {
    expect(matchAts("https://jobs.workday.com/acme/abc")).toBeNull();
  });

  it("rejects a spoofed host", () => {
    expect(matchAts("https://myworkdayjobs.com.evil.com/x")).toBeNull();
  });
});

describe("skills classification", () => {
  it("classifies a Skills field", () => {
    expect(classifyField(desc({ label: "Skills" }))).toBe("skills");
    expect(classifyField(desc({ label: "Key Skills", required: true }))).toBe("skills");
  });

  it("does not classify a long skills question as the skills field", () => {
    expect(
      classifyField(desc({ label: "Describe the skills you would bring to this team" })),
    ).not.toBe("skills");
  });
});

describe("fill-plan for skills", () => {
  it("emits a fillable multi-value item from profile.skills", () => {
    const [item] = buildFillPlan([desc({ label: "Skills" })], withSkills(["C++", "Linux", "CUDA"]));
    expect(item!.status).toBe("fillable");
    expect(item!.source).toBe("personal");
    expect(item!.values).toEqual(["C++", "Linux", "CUDA"]);
  });

  it("is needs-answer when the profile has no skills", () => {
    const [item] = buildFillPlan([desc({ label: "Skills" })], withSkills([]));
    expect(item!.status).toBe("needs-answer");
    expect(item!.values ?? []).toEqual([]);
  });

  it("leaves other fields' shape unchanged (no stray values array)", () => {
    const [item] = buildFillPlan([desc({ label: "Email" })], withSkills(["C++"]));
    expect(item!.values).toBeUndefined();
  });
});
