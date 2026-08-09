/**
 * Independent audit of the three answer-guard classes.
 * Each test states the CLAIM it is falsifying.
 */
import { describe, expect, it } from "vitest";
import { guardClassOf, isAutoAnswerForbidden, needsPostFillReview } from "../guards";

/**
 * Why the fill path must hand these guards the real question.
 *
 * The guards match on the question text. Measured on a live Ashby form on
 * 2026-08-09, the label-scraping path returned an EMPTY label for both work
 * authorization and visa sponsorship — it had taken the first option, or found
 * nothing — and an empty label matches nothing, so neither question was
 * guarded and both were eligible for AI answering. The guards were right; they
 * were being handed nothing.
 *
 * Reading the ATS's own field definition (packages/autofill/field-meta.ts) is
 * what supplies the text. These two tests pin both halves so the dependency
 * cannot be quietly broken again.
 */
describe("guards depend on being given the question", () => {
  const YES_NO = ["Yes", "No"];

  it("a blank label leaves the most consequential questions unguarded", () => {
    expect(guardClassOf({ label: "", options: YES_NO })).toBeNull();
    // And the first option is no better — that is what the scraper produced.
    expect(guardClassOf({ label: "Yes", options: YES_NO })).toBeNull();
  });

  it("the real question text is guarded as truth", () => {
    for (const q of [
      "Will you require visa sponsorship now or in the future?",
      "Are you authorized to work in the United States",
    ]) {
      expect(guardClassOf({ label: q, options: YES_NO })).toBe("truth");
    }
  });
});

describe("AUDIT guards: truth-required facts", () => {
  it("work-authorization/sponsorship is NEVER auto-answered — options are not inspected", () => {
    // A radio group whose LABEL is neutral (or absent, which real ATS forms do
    // when the question sits in a preceding <h3>) and whose OPTIONS carry the
    // sponsorship question. SENSITIVE checks options; TRUTH does not.
    const subject = {
      label: "Please select one",
      options: [
        "I am authorized to work in the US and will not require visa sponsorship",
        "I will require visa sponsorship now or in the future",
      ],
    };
    expect(guardClassOf(subject)).toBe("truth");
    expect(isAutoAnswerForbidden(subject)).toBe(true);
  });

  it("truth guard covers legal work-status facts — citizenship is not covered", () => {
    for (const label of [
      "Are you a U.S. citizen?",
      "Are you a lawful permanent resident (green card holder)?",
      "Do you hold current employment authorization in Canada?",
    ]) {
      expect(isAutoAnswerForbidden({ label })).toBe(true);
    }
  });
});

describe("AUDIT guards: policy acknowledgments", () => {
  it("every policy acknowledgment is surfaced — options are not inspected", () => {
    // A checkbox group with no label of its own; the acknowledgment text is
    // the option. Filled by the choice lane, then invisible to the review card.
    const subject = {
      label: "",
      options: ["I acknowledge and agree to the AI-use policy described above"],
    };
    expect(needsPostFillReview(subject)).toBe(true);
  });

  it("policy class means 'acknowledgment shape' — ordinary questions match too", () => {
    // These are essay questions, not agreements. They are auto-answered (fine)
    // and then listed under "Check what you agreed to" as if they were consents.
    for (const label of [
      "Describe a time you challenged a company policy.",
      "Do you agree that code review improves quality? Explain.",
      "Which policy area of our product interests you most?",
    ]) {
      expect(needsPostFillReview({ label })).toBe(false);
    }
  });
});

describe("AUDIT guards: precedence", () => {
  it("most restrictive wins when a question reads as several", () => {
    // sanity: this one the author got right, kept as a control.
    expect(
      guardClassOf({
        label: "I acknowledge that this employer does not sponsor visas.",
      }),
    ).toBe("truth");
  });
});
