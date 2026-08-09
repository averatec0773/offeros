/**
 * Independent audit of the evidence library + self-assessment ledger.
 */
import { describe, expect, it } from "vitest";
import { scoreEvidence, selectEvidence, formatEvidence } from "../evidence-match";
import { matchAnswer } from "../answer-match";
import type { AnswerEntry } from "../types";

const item = (over: Partial<Parameters<typeof scoreEvidence>[0]> = {}) => ({
  id: "x",
  title: "Weekend game jam entry",
  url: "https://example.com/jam",
  summary: "A tiny puzzle game",
  stack: ["C++"],
  outcome: "",
  ...over,
});

describe("AUDIT evidence: irrelevant work must be dropped, not padded in", () => {
  it("only work whose stack overlaps the posting is offered", () => {
    const job = "Senior Payments Engineer. Ruby on Rails, Postgres, Stripe.";
    // Nothing about this project overlaps the posting. Its only stack entry
    // normalizes to zero tokens, so `tokens(s).every(...)` is vacuously true.
    expect(scoreEvidence(item(), job)).toBe(0);
    expect(selectEvidence([item()], job)).toEqual([]);
  });

  it("same, for the other punctuation-only stacks people really write", () => {
    const job = "Senior Payments Engineer. Ruby on Rails, Postgres, Stripe.";
    for (const stack of [["C#"], ["R"], ["C"], [""], ["!"], ["Go", "C++"]]) {
      expect({ stack, score: scoreEvidence(item({ stack }), job) }).toEqual({ stack, score: 0 });
    }
  });
});

describe("AUDIT evidence: rendering into a real form field", () => {
  it("the rendered answer is safe for the fields these patterns target", () => {
    // "portfolio" / "personal website" are EVIDENCE_PATTERNS in fill-service,
    // and those land on single-line <input>s. A value with newlines in it is
    // truncated at the first \n by many inputs and rejected by others.
    const out = formatEvidence([item({ stack: ["Rust"] }), item({ id: "y", stack: ["Rust"] })]);
    expect(out).not.toContain("\n");
  });
});

describe("AUDIT derived answers: precedence against a stored answer", () => {
  // Exactly what fill-service builds: the stored bank first, then derived.
  const EVIDENCE_PATTERNS = [
    "links to any relevant work",
    "links to relevant work",
    "relevant work",
    "github repositories",
    "portfolio",
    "personal website",
    "technical projects",
    "projects or write ups",
  ];
  const stored: AnswerEntry = {
    id: "stored",
    questionPatterns: ["relevant work"],
    answer: "Everything I can share is on my resume.",
    type: "text",
    category: "custom",
  };
  const derived: AnswerEntry = {
    id: "derived:evidence",
    questionPatterns: EVIDENCE_PATTERNS,
    answer: "Some project — https://example.com",
    type: "text",
    category: "custom",
    // Provenance is the deciding factor now: a derived pattern is routinely
    // longer than anything a person types, so "longest wins" alone used to
    // override the user's own words.
    derived: true,
  };

  it("a stored answer ALWAYS beats a derived one", () => {
    const bank = [stored, derived];
    const hit = matchAnswer(
      "Please share links to any relevant work you would like us to see.",
      bank,
    );
    expect(hit?.id).toBe("stored");
  });

  it("a committed rating answers only rating-shaped questions about its topic", () => {
    // A bare topic as the pattern was the defect: "Go" is a whole word inside
    // ordinary prose, and a derived entry arrives as `fillable`, so a one-word
    // rating would be typed into an unrelated field with no guard and no
    // review. Patterns now carry a rating cue.
    const goRating: AnswerEntry = {
      id: "derived:self-assessment:go",
      questionPatterns: ["rate your Go", "Go proficiency", "how often did you use Go"],
      answer: "Advanced",
      type: "enum",
      category: "custom",
      derived: true,
    };
    expect(matchAnswer("How far are you willing to go for a deadline?", [goRating])).toBeNull();
    expect(matchAnswer("Which office would you like to go to?", [goRating])).toBeNull();
    // …and it still answers the question it exists for.
    expect(matchAnswer("How would you rate your Go?", [goRating])?.answer).toBe("Advanced");
  });
});
