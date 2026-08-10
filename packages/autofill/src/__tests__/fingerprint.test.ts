import { describe, expect, it } from "vitest";
import { fnv1a64, formFingerprint, newQuestions, questionKey } from "../fingerprint";
import type { FieldDescriptor } from "../classify";
import type { FieldMeta } from "../field-meta";

const desc = (over: Partial<FieldDescriptor> = {}): FieldDescriptor => ({
  fieldId: "offeros-1",
  label: "",
  name: "",
  autocomplete: "",
  type: "text",
  placeholder: "",
  ariaLabel: "",
  ...over,
});

const meta = (over: Partial<FieldMeta> = {}): FieldMeta => ({
  question: "Where in the United States will you be working from?",
  control: "single-select",
  groupId: "group-1",
  required: true,
  options: ["Remote (U.S.)", "Austin Office", "San Francisco Office", "I'm flexible"],
  source: "props",
  ...over,
});

describe("fnv1a64", () => {
  /**
   * The 64-bit width is the whole collision argument, and the implementation is
   * hand-rolled 32-bit arithmetic because the extension targets below ES2020.
   * So the width and the spread have to be asserted, not assumed — an
   * implementation that silently only varied its low half would pass every
   * other test in this file while collapsing the collision budget to 32 bits.
   */
  it("uses the whole 64 bits, both halves varying", () => {
    const keys = Array.from({ length: 500 }, (_, i) => fnv1a64(`question ${i}`));
    expect(new Set(keys).size).toBe(500);
    expect(new Set(keys.map((k) => k.slice(0, 8))).size).toBeGreaterThan(400);
    expect(new Set(keys.map((k) => k.slice(8))).size).toBeGreaterThan(400);
  });

  it("changes throughout the digest for a one-character difference", () => {
    // Avalanche, roughly: a single edit should not leave most of the hash alone.
    const a = fnv1a64("Are you authorized to work here?");
    const b = fnv1a64("Are you authorized to work there?");
    const same = [...a].filter((ch, i) => ch === b[i]).length;
    expect(same).toBeLessThan(8);
  });

  it("is stable and 64 bits wide", () => {
    expect(fnv1a64("hello")).toBe(fnv1a64("hello"));
    expect(fnv1a64("hello")).toHaveLength(16);
    expect(fnv1a64("hello")).not.toBe(fnv1a64("hellp"));
  });
});

describe("questionKey", () => {
  it("is the same question across two different postings", () => {
    // The whole point. Two postings at the same employer ask this identically;
    // if they keyed differently, nothing would ever be recognised as seen.
    const a = questionKey(meta({ groupId: "posting-a-uuid" }), desc({ fieldId: "offeros-3" }));
    const b = questionKey(meta({ groupId: "posting-b-uuid" }), desc({ fieldId: "offeros-41" }));
    expect(a).toBe(b);
  });

  it("ignores option order", () => {
    // Employers reorder EEO lists; the question has not changed.
    const forward = questionKey(meta(), desc());
    const reversed = questionKey(meta({ options: [...meta().options!].reverse() }), desc());
    expect(forward).toBe(reversed);
  });

  it("ignores casing, surrounding space and required markers", () => {
    const plain = questionKey(meta({ question: "Are you authorized to work here?" }), desc());
    const noisy = questionKey(meta({ question: "  ARE YOU AUTHORIZED TO WORK HERE? * " }), desc());
    expect(plain).toBe(noisy);
  });

  it("does NOT merge abbreviations that punctuation splits — a known limitation", () => {
    // normalizeQuestion turns "U.S." into "u s" and "US" into "us", so the same
    // question phrased both ways is analysed twice. Deliberate: the fingerprint
    // shares its normaliser with answer matching, and a bespoke one here would
    // let a question match a saved answer while counting as a brand new shape.
    // One extra analysis is cheaper than that inconsistency.
    const withDots = questionKey(meta({ question: "Authorized to work in the U.S.?" }), desc());
    const without = questionKey(meta({ question: "Authorized to work in the US?" }), desc());
    expect(withDots).not.toBe(without);
  });

  it("separates two questions that differ only in their options", () => {
    // Same words, different choices, different answer — must not share a rule.
    const two = questionKey(meta({ options: ["Yes", "No"] }), desc());
    const four = questionKey(meta(), desc());
    expect(two).not.toBe(four);
  });

  it("separates two questions that differ only in control type", () => {
    const select = questionKey(meta({ control: "single-select" }), desc());
    const text = questionKey(meta({ control: "text" }), desc());
    expect(select).not.toBe(text);
  });

  it("falls back through label, aria-label and name when there is no metadata", () => {
    // Lever exposes no metadata at all; the key still has to be computable.
    const fromLabel = questionKey(null, desc({ label: "Full name", type: "text" }));
    const fromAria = questionKey(null, desc({ ariaLabel: "Full name", type: "text" }));
    expect(fromLabel).toBe(fromAria);
    expect(fromLabel).not.toBe(questionKey(null, desc({ label: "Email", type: "text" })));
  });

  it("prefers the ATS's own question over a wrong scraped label", () => {
    // Measured on a live form: the label was "She/her" for a question the ATS
    // calls "What pronouns do you use?". Keying on the label would make every
    // option look like its own question.
    const viaMeta = questionKey(
      meta({ question: "What pronouns do you use?" }),
      desc({ label: "She/her" }),
    );
    const viaMetaAgain = questionKey(
      meta({ question: "What pronouns do you use?" }),
      desc({ label: "He/him" }),
    );
    expect(viaMeta).toBe(viaMetaAgain);
  });
});

describe("formFingerprint", () => {
  it("is order-independent and vendor-scoped", () => {
    expect(formFingerprint("ashby", ["a", "b"])).toBe(formFingerprint("ashby", ["b", "a", "b"]));
    expect(formFingerprint("ashby", ["a"])).not.toBe(formFingerprint("greenhouse", ["a"]));
  });

  it("changes when a single question is added", () => {
    // Which is exactly why novelty is decided per question, not per form: one
    // extra optional question must not make 80 known ones look new.
    expect(formFingerprint("ashby", ["a", "b"])).not.toBe(
      formFingerprint("ashby", ["a", "b", "c"]),
    );
  });
});

describe("newQuestions", () => {
  it("returns only the keys never recorded, deduplicated", () => {
    expect(newQuestions(["a", "b", "a", "c"], new Set(["a"]))).toEqual(["b", "c"]);
    expect(newQuestions(["a"], new Set(["a"]))).toEqual([]);
    expect(newQuestions([], new Set())).toEqual([]);
  });
});
