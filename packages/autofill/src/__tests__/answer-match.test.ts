import { describe, expect, it } from "vitest";
import { matchAnswer, normalizeQuestion } from "../answer-match";
import type { AnswerEntry } from "../types";

const bank: AnswerEntry[] = [
  {
    id: "sponsor",
    answer: "Yes",
    type: "boolean",
    category: "eeo",
    questionPatterns: [
      "require sponsorship",
      "need sponsorship",
      "employment visa status",
      "sponsorship",
    ],
  },
  {
    id: "workauth",
    answer: "Yes",
    type: "boolean",
    category: "eeo",
    questionPatterns: ["authorized to work", "legally authorized"],
  },
  {
    id: "veteran",
    answer: "No",
    type: "enum",
    category: "eeo",
    questionPatterns: ["veteran"],
  },
];

describe("normalizeQuestion", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeQuestion("  Will you NOW, or in the future,\nrequire sponsorship?  ")).toBe(
      "will you now or in the future require sponsorship",
    );
  });
});

describe("matchAnswer", () => {
  it("matches the sponsorship question", () => {
    expect(
      matchAnswer("Will you now or in the future require sponsorship for employment?", bank)?.id,
    ).toBe("sponsor");
  });
  it("matches work authorization independently", () => {
    expect(matchAnswer("Are you legally authorized to work in the United States?", bank)?.id).toBe(
      "workauth",
    );
  });
  it("prefers the longest matching pattern when several entries hit", () => {
    // "employment visa status" (3 words) beats "veteran" (irrelevant) and ties resolve by specificity
    expect(matchAnswer("What is your employment visa status?", bank)?.id).toBe("sponsor");
  });
  it("returns null when nothing matches", () => {
    expect(matchAnswer("What is your favorite color?", bank)).toBeNull();
  });

  it("does not match a pattern inside another word (word boundary)", () => {
    const raceBank: AnswerEntry[] = [
      {
        id: "race",
        answer: "Decline to self-identify",
        type: "enum",
        category: "eeo",
        questionPatterns: ["race"],
      },
    ];
    expect(matchAnswer("Do you embrace new challenges?", raceBank)).toBeNull();
    expect(matchAnswer("How would you trace a bug?", raceBank)).toBeNull();
    expect(matchAnswer("What is your race?", raceBank)?.id).toBe("race");
    expect(matchAnswer("Race/Ethnicity", raceBank)?.id).toBe("race");
  });

  it("multi-word patterns still match inside longer questions", () => {
    expect(
      matchAnswer("Are you now or will you in the future require sponsorship?", bank)?.id,
    ).toBe("sponsor");
  });

  it("matches sponsorship when words are inserted mid-phrase (real Greenhouse phrasing)", () => {
    expect(
      matchAnswer(
        "Will you now require immigration sponsorship by our company for employment?",
        bank,
      )?.id,
    ).toBe("sponsor");
  });
});
