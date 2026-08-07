import { describe, expect, it } from "vitest";
import { buildFillPlan, classifiedRatio, fillCoverage } from "../fill-plan";
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

describe("buildFillPlan", () => {
  it("maps a canonical field with a value to fillable/personal", () => {
    const [item] = buildFillPlan([d("f1", { label: "Email" })], profile);
    expect(item).toMatchObject({
      fieldId: "f1",
      status: "fillable",
      value: "a@b.c",
      source: "personal",
    });
  });

  it("splits fullName into first/last when asked", () => {
    const first = buildFillPlan([d("f1", { label: "First name" })], profile)[0]!;
    const last = buildFillPlan([d("f2", { label: "Last name" })], profile)[0]!;
    expect(first.value).toBe("Jordan");
    expect(last.value).toBe("Rivera");
  });

  it("marks a recognized field with no stored value as needs-answer", () => {
    const item = buildFillPlan([d("f1", { label: "Phone number" })], profile)[0]!;
    expect(item.status).toBe("needs-answer");
    expect(item.value).toBe("");
  });

  it("resume is always needs-answer in this plan (manual upload)", () => {
    const item = buildFillPlan([d("f1", { type: "file", label: "Resume" })], profile)[0]!;
    expect(item.status).toBe("needs-answer");
    expect(item.source).toBe("personal");
  });

  it("a file input classified as a non-resume canonical is never fillable", () => {
    const item = buildFillPlan(
      [d("f1", { type: "file", label: "Portfolio", autocomplete: "url" })],
      profile,
    )[0]!;
    expect(item.status).toBe("needs-answer");
    expect(item.value).toBe("");
  });

  it("matches a screening question with a stored answer to fillable/answerBank", () => {
    const item = buildFillPlan(
      [d("f1", { label: "Are you authorized to work in the US?" })],
      profile,
    )[0]!;
    expect(item).toMatchObject({ status: "fillable", value: "Yes", source: "answerBank" });
  });

  it("matched question with an empty answer is needs-answer", () => {
    const item = buildFillPlan([d("f1", { label: "Will you require sponsorship?" })], profile)[0]!;
    expect(item).toMatchObject({ status: "needs-answer", source: "answerBank" });
  });

  it("an unrecognized field is unknown", () => {
    const item = buildFillPlan([d("f1", { label: "Describe your ideal team" })], profile)[0]!;
    expect(item).toMatchObject({ status: "unknown", source: "none", value: "" });
  });

  it("null profile makes every field unknown or needs-answer, never fillable", () => {
    const plan = buildFillPlan([d("f1", { label: "Email" }), d("f2", { label: "xyz" })], null);
    expect(plan.every((i) => i.status !== "fillable")).toBe(true);
  });

  it("any file input is needs-answer even when unclassified", () => {
    const item = buildFillPlan(
      [d("f1", { type: "file", label: "Cover letter upload" })],
      profile,
    )[0]!;
    expect(item.status).toBe("needs-answer");
    expect(item.source).toBe("personal");
  });

  it("answerBank matches carry the entry id for save-back", () => {
    const item = buildFillPlan(
      [d("f1", { label: "Are you authorized to work in the US?" })],
      profile,
    )[0]!;
    expect(item.answerId).toBe("s1");
  });

  it("propagates the descriptor's required flag onto the plan item", () => {
    const req = buildFillPlan([d("f1", { label: "Email", required: true })], profile)[0]!;
    const opt = buildFillPlan([d("f2", { label: "Email" })], profile)[0]!;
    expect(req.required).toBe(true);
    expect(opt.required).toBe(false);
  });
});

describe("fillCoverage", () => {
  it("counts filled required fields over total required", () => {
    const plan = buildFillPlan(
      [
        d("f1", { label: "Email", required: true }), // fillable
        d("f2", { label: "Phone number", required: true }), // needs-answer (no value)
        d("f3", { label: "Describe your ideal team" }), // optional, unknown
      ],
      profile,
    );
    const c = fillCoverage(plan);
    expect(c).toMatchObject({ filled: 1, total: 2, percent: 50, requiredBasis: true });
  });

  it("falls back to all fields when nothing is marked required", () => {
    const plan = buildFillPlan(
      [d("f1", { label: "Email" }), d("f2", { label: "Describe your ideal team" })],
      profile,
    );
    const c = fillCoverage(plan);
    expect(c).toMatchObject({ filled: 1, total: 2, percent: 50, requiredBasis: false });
  });

  it("is 100% for an empty plan", () => {
    expect(fillCoverage([]).percent).toBe(100);
  });
});

describe("classifiedRatio", () => {
  it("is the share of recognized fields", () => {
    const plan = buildFillPlan(
      [
        d("f1", { label: "Email" }),
        d("f2", { label: "Aaa?" }),
        d("f3", { label: "Bbb?" }),
        d("f4", { label: "Ccc?" }),
      ],
      profile,
    );
    expect(classifiedRatio(plan)).toBe(0.25);
  });

  it("is 1 for an empty plan (no drift on nothing)", () => {
    expect(classifiedRatio([])).toBe(1);
  });
});

describe("buildFillPlan — open-ended questions (generatable)", () => {
  it("marks a free-text textarea question as generatable", () => {
    const [item] = buildFillPlan(
      [d("q1", { label: "Why do you want to work at Intel?", type: "textarea" })],
      profile,
    );
    expect(item!.source).toBe("generate");
    expect(item!.generatable).toBe(true);
    expect(item!.status).toBe("needs-answer");
  });

  it("marks a long free-text question (non-textarea) as generatable", () => {
    const [item] = buildFillPlan(
      [d("q2", { label: "Describe a challenging project you led and the outcome" })],
      profile,
    );
    expect(item!.generatable).toBe(true);
  });

  it("does not mark a short unknown field as generatable", () => {
    const [item] = buildFillPlan([d("q3", { label: "Referral code" })], profile);
    expect(item!.source).toBe("none");
    expect(item!.generatable).toBeUndefined();
  });

  it("prefers an answer-bank match over generation", () => {
    const [item] = buildFillPlan(
      [d("q4", { label: "Are you authorized to work in the US?", type: "textarea" })],
      profile,
    );
    expect(item!.source).toBe("answerBank");
    expect(item!.generatable).toBeUndefined();
  });
});

describe("choice groups", () => {
  const desc = (over: Partial<import("../classify").FieldDescriptor>) => ({
    fieldId: "g1", label: "", name: "radio:x", autocomplete: "", type: "radio-group",
    placeholder: "", ariaLabel: "", options: [] as string[], ...over,
  });
  const profile = {
    personal: { name: "", email: "", phone: "", address: "", links: {} },
    skills: [],
    answerBank: [
      { id: "a1", questionPatterns: ["gender"], answer: "Decline to self-identify", type: "enum" as const, category: "eeo" as const },
    ],
  };

  it("answers from the bank only when the stored answer maps onto an option", () => {
    const [item] = buildFillPlan(
      [desc({ label: "What is your gender?", options: ["Male", "Female", "Decline to self-identify"] })],
      profile,
    );
    expect(item!.status).toBe("fillable");
    expect(item!.value).toBe("Decline to self-identify");
    expect(item!.source).toBe("answerBank");
  });

  it("stays needs-answer when the stored answer matches no option", () => {
    const [item] = buildFillPlan(
      [desc({ label: "What is your gender?", options: ["A", "B"] })],
      profile,
    );
    expect(item!.status).toBe("needs-answer");
  });

  it("fills recentCompany/recentTitle from the profile", () => {
    const p2 = { ...profile, personal: { ...profile.personal, recentCompany: "Acme", recentTitle: "Engineer" } };
    const items = buildFillPlan(
      [
        desc({ fieldId: "c", type: "text", label: "What is your most recent company?", name: "", options: undefined }),
        desc({ fieldId: "t", type: "text", label: "What is your most recent job title?", name: "", options: undefined }),
      ],
      p2,
    );
    expect(items.map((i) => [i.status, i.value])).toEqual([
      ["fillable", "Acme"],
      ["fillable", "Engineer"],
    ]);
  });
});
