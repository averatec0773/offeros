import { describe, expect, it } from "vitest";
import { buildFillPlan, explainFillPlan } from "../fill-plan";
import type { FillProfile } from "../types";
import type { FieldDescriptor } from "../classify";

const d = (fieldId: string, partial: Partial<FieldDescriptor>): FieldDescriptor => ({
  fieldId,
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

const profile = (() => {
  const p = emptyProfile();
  p.personal.name = "Jordan Rivera";
  p.personal.email = "a@b.c";
  p.personal.links.linkedin = "https://linkedin.com/in/yh";
  p.skills = ["TypeScript", "React"];
  p.answerBank.push({
    id: "s1",
    questionPatterns: ["authorized to work"],
    answer: "Yes",
    type: "boolean",
    category: "eeo",
  });
  p.answerBank.push({
    id: "s2",
    questionPatterns: ["require sponsorship"],
    answer: "",
    type: "boolean",
    category: "eeo",
  });
  return p;
})();

const descriptors: FieldDescriptor[] = [
  d("f1", { label: "Email" }), // personal, filled
  d("f2", { label: "Phone number" }), // personal, empty -> needs-answer
  d("f3", { label: "Skills" }), // skills, filled
  d("f4", { label: "Are you authorized to work in the US?" }), // answerBank, filled
  d("f5", { label: "Will you require sponsorship?" }), // answerBank, empty -> needs-answer
  d("f6", { label: "Describe your ideal team" }), // unknown
  d("f7", { label: "Why do you want to work here and what draws you to this role" }), // generatable
  d("f8", { type: "file", label: "Resume" }), // file, manual
];

describe("explainFillPlan", () => {
  it("plan is identical to buildFillPlan's output (behavior preserved)", () => {
    const { plan } = explainFillPlan(descriptors, profile);
    expect(plan).toEqual(buildFillPlan(descriptors, profile));
  });

  it("plan is identical to buildFillPlan's output with a null profile", () => {
    const { plan } = explainFillPlan(descriptors, null);
    expect(plan).toEqual(buildFillPlan(descriptors, null));
  });

  it("returns one trace entry per field, same order and fieldIds as the plan", () => {
    const { plan, trace } = explainFillPlan(descriptors, profile);
    expect(trace).toHaveLength(descriptors.length);
    expect(trace.map((t) => t.fieldId)).toEqual(plan.map((p) => p.fieldId));
  });

  it("every trace has a non-empty reason", () => {
    const { trace } = explainFillPlan(descriptors, profile);
    for (const t of trace) {
      expect(t.reason.length).toBeGreaterThan(0);
    }
  });

  it("a personal-filled field names the classified type and profile path", () => {
    const { trace } = explainFillPlan(descriptors, profile);
    const email = trace.find((t) => t.fieldId === "f1")!;
    expect(email.classifiedType).toBe("email");
    expect(email.source).toBe("personal");
    expect(email.status).toBe("fillable");
    expect(email.chosenValue).toBe("a@b.c");
    expect(email.reason).toContain("email");
    expect(email.reason).toContain("profile.personal.email");
  });

  it("a personal field with no stored value explains needs-answer", () => {
    const { trace } = explainFillPlan(descriptors, profile);
    const phone = trace.find((t) => t.fieldId === "f2")!;
    expect(phone.classifiedType).toBe("phone");
    expect(phone.status).toBe("needs-answer");
    expect(phone.reason).toContain("phone");
    expect(phone.reason.toLowerCase()).toContain("needs-answer");
  });

  it("a skills field names the skills branch and carried count", () => {
    const { trace } = explainFillPlan(descriptors, profile);
    const skills = trace.find((t) => t.fieldId === "f3")!;
    expect(skills.classifiedType).toBe("skills");
    expect(skills.source).toBe("personal");
    expect(skills.status).toBe("fillable");
    expect(skills.chosenValue).toBe("TypeScript, React");
    expect(skills.reason).toContain("skills");
    expect(skills.reason).toContain("2");
  });

  it("an answer-bank-matched field names the answer-bank branch", () => {
    const { trace } = explainFillPlan(descriptors, profile);
    const eeo = trace.find((t) => t.fieldId === "f4")!;
    expect(eeo.classifiedType).toBe("unknown");
    expect(eeo.source).toBe("answerBank");
    expect(eeo.status).toBe("fillable");
    expect(eeo.chosenValue).toBe("Yes");
    expect(eeo.reason).toContain("answer-bank");
  });

  it("an answer-bank match with an empty stored answer explains needs-answer", () => {
    const { trace } = explainFillPlan(descriptors, profile);
    const sponsorship = trace.find((t) => t.fieldId === "f5")!;
    expect(sponsorship.source).toBe("answerBank");
    expect(sponsorship.status).toBe("needs-answer");
    expect(sponsorship.reason).toContain("answer-bank");
    expect(sponsorship.reason.toLowerCase()).toContain("needs-answer");
  });

  it("an unclassifiable field is unknown with a matching reason", () => {
    const { trace } = explainFillPlan(descriptors, profile);
    const unknown = trace.find((t) => t.fieldId === "f6")!;
    expect(unknown.classifiedType).toBe("unknown");
    expect(unknown.source).toBe("none");
    expect(unknown.status).toBe("unknown");
    expect(unknown.reason.toLowerCase()).toContain("no classifier match");
  });

  it("an open-ended question names the generate branch", () => {
    const { trace } = explainFillPlan(descriptors, profile);
    const openEnded = trace.find((t) => t.fieldId === "f7")!;
    expect(openEnded.source).toBe("generate");
    expect(openEnded.reason.toLowerCase()).toContain("generat");
  });

  it("a file input names the manual-upload branch", () => {
    const { trace } = explainFillPlan(descriptors, profile);
    const resume = trace.find((t) => t.fieldId === "f8")!;
    expect(resume.status).toBe("needs-answer");
    expect(resume.reason.toLowerCase()).toContain("manual upload");
  });
});
