import { describe, it, expect } from "vitest";
import type { AnalyzeFieldInput, AnalyzeSources, FieldAnalysis } from "@offeros/llm";
import { evidenceHolds, eligibleForAnalysis, resolveAnalyses } from "../field-analysis-service";

/**
 * The half of the analysis that decides what may actually reach the page.
 *
 * Everything the model returns arrives here as a claim. What these tests hold
 * is that a claim is not permission: the questions only the applicant can
 * answer are refused on the field's own text, and every value has to point at
 * the words it came from — checked here, against the material, rather than
 * requested in a prompt.
 */

const sources: AnalyzeSources = {
  profile: [
    "Personal:",
    "  name: Jordan Rivera",
    "Work history (most recent first):",
    "  [0] Senior Engineer at Northwind Systems (2021–Present)",
    "      - Led the ingestion rewrite, cutting nightly batch latency by 40%.",
    "  [1] Engineer at Lakeside Analytics (2018–2021)",
  ].join("\n"),
  resume: "Jordan Rivera — Senior Engineer. Built streaming pipelines in Go and TypeScript.",
  jobDescription: "We are hiring a Backend Engineer to own our data ingestion pipeline.",
  savedAnswers: [
    { question: "why do you want to work here", answer: "The problem is interesting." },
  ],
};

const field = (over: Partial<AnalyzeFieldInput> = {}): AnalyzeFieldInput => ({
  fieldId: "f1",
  label: "Most recent employer",
  type: "text",
  ...over,
});

const analysis = (over: Partial<FieldAnalysis> = {}): FieldAnalysis => ({
  fieldId: "f1",
  value: "Northwind Systems",
  from: "profile",
  evidence: "Senior Engineer at Northwind Systems",
  reason: "your most recent job",
  ...over,
});

describe("an answer has to point at the words it came from", () => {
  it("accepts a value whose evidence is in the source it names", () => {
    const [r] = resolveAnalyses([analysis()], [field()], sources);
    expect(r!.value).toBe("Northwind Systems");
    expect(r!.source).toBe("agent");
    expect(r!.needsUser).toBeUndefined();
  });

  it("discards a value whose evidence is nowhere in that source", () => {
    // The whole anti-fabrication check: a plausible employer with a quote that
    // does not exist is thrown away by arithmetic, not by trusting the model.
    const [r] = resolveAnalyses(
      [analysis({ value: "Globex Corporation", evidence: "Senior Engineer at Globex" })],
      [field()],
      sources,
    );
    expect(r!.value).toBeNull();
    expect(r!.needsUser).toBe(true);
    expect(r!.reason).toMatch(/couldn't trace/i);
  });

  it("discards a value that cites the wrong source", () => {
    // The words are in the profile, not the job description.
    const [r] = resolveAnalyses([analysis({ from: "job-description" })], [field()], sources);
    expect(r!.value).toBeNull();
  });

  it("tolerates a quote reflowed on whitespace and punctuation", () => {
    // A model that rewraps a quote is still quoting.
    const [r] = resolveAnalyses(
      [analysis({ evidence: "Senior Engineer  at   Northwind Systems." })],
      [field()],
      sources,
    );
    expect(r!.value).toBe("Northwind Systems");
  });

  it("refuses evidence too short to distinguish anything", () => {
    // A three-character quote appears in every document.
    const [r] = resolveAnalyses([analysis({ evidence: "at" })], [field()], sources);
    expect(r!.value).toBeNull();
  });

  it("refuses a value with no evidence at all", () => {
    const [r] = resolveAnalyses(
      [analysis({ evidence: undefined, from: undefined })],
      [field()],
      sources,
    );
    expect(r!.value).toBeNull();
  });

  it("reads evidence out of the résumé and the saved answers too", () => {
    expect(
      evidenceHolds(analysis({ from: "resume", evidence: "streaming pipelines in Go" }), sources),
    ).toBe(true);
    expect(
      evidenceHolds(
        analysis({ from: "saved-answers", evidence: "The problem is interesting" }),
        sources,
      ),
    ).toBe(true);
  });
});

describe("questions only the applicant can answer", () => {
  it.each([
    ["Gender", "sensitive"],
    ["Veteran status", "sensitive"],
    ["Are you legally authorized to work in the United States?", "truth"],
    ["Will you now or in the future require visa sponsorship?", "truth"],
  ])("%o is never given a value, however confident the model was", (label) => {
    const [r] = resolveAnalyses(
      [analysis({ value: "Yes", evidence: "Senior Engineer at Northwind Systems" })],
      [field({ label })],
      sources,
    );
    expect(r!.value).toBeNull();
    expect(r!.needsUser).toBe(true);
  });

  it("catches a guarded question that only its OPTIONS give away", () => {
    const [r] = resolveAnalyses(
      [analysis({ value: "I will not require visa sponsorship" })],
      [
        field({
          label: "Please select one",
          type: "radio-group",
          options: [
            "I will not require visa sponsorship",
            "I will require sponsorship now or in the future",
          ],
        }),
      ],
      sources,
    );
    expect(r!.value).toBeNull();
    expect(r!.reason).toMatch(/only you can make/i);
  });
});

describe("honest nulls", () => {
  it("passes a null through with the model's own reason", () => {
    const [r] = resolveAnalyses(
      [
        analysis({
          value: null,
          from: undefined,
          evidence: undefined,
          reason: "nothing on file about certifications",
        }),
      ],
      [field({ label: "Certifications" })],
      sources,
    );
    expect(r!.value).toBeNull();
    expect(r!.needsUser).toBe(true);
    expect(r!.reason).toContain("certifications");
  });

  it("treats an empty string as no answer", () => {
    const [r] = resolveAnalyses([analysis({ value: "   " })], [field()], sources);
    expect(r!.value).toBeNull();
  });

  it("refuses a multiple-choice answer that is not one of the options", () => {
    const [r] = resolveAnalyses(
      [analysis({ value: "Maybe" })],
      [field({ type: "radio-group", options: ["Yes", "No"] })],
      sources,
    );
    expect(r!.value).toBeNull();
    expect(r!.reason).toMatch(/options matched/i);
  });

  it("drops a fieldId that was never sent", () => {
    // Otherwise a model could add rows to a plan keyed by fieldId.
    expect(
      resolveAnalyses([analysis({ fieldId: "not-on-this-page" })], [field()], sources),
    ).toEqual([]);
  });
});

describe("what is worth spending a call on", () => {
  it("skips a field the page already holds a value for", () => {
    expect(eligibleForAnalysis({ currentValue: "already typed" })).toBe(false);
    expect(eligibleForAnalysis({ currentValue: "   " })).toBe(true);
    expect(eligibleForAnalysis({})).toBe(true);
  });
});
