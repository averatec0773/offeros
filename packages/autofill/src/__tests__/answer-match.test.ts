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

describe("token rung — rewording tolerance (wave-1 EEO gap)", () => {
  const entry = (over: Partial<AnswerEntry>): AnswerEntry => ({
    id: "e1",
    questionPatterns: [],
    answer: "A",
    type: "text",
    category: "eeo",
    ...over,
  });

  it('matches "Are you Hispanic or Latino?" bank entry against "Are you Hispanic/Latino?"', () => {
    // The exact live miss: "/" normalizes to a space, the bank's "or" has no
    // counterpart, and the phrase rung fails on a question the user answered.
    const bank = [entry({ id: "hisp", questionPatterns: ["Are you Hispanic or Latino?"] })];
    expect(matchAnswer("Are you Hispanic/Latino?", bank)?.id).toBe("hisp");
  });

  it("still refuses to match inside other words on the token rung", () => {
    const bank = [entry({ id: "race", questionPatterns: ["your race"] })];
    expect(matchAnswer("How would you embrace challenges?", bank)).toBeNull();
  });

  it("an all-stopword pattern identifies nothing", () => {
    const bank = [entry({ id: "junk", questionPatterns: ["are you the"] })];
    expect(matchAnswer("Are you the applicant?", bank)?.id).toBe("junk"); // phrase rung still works
    expect(matchAnswer("You are the one", bank)).toBeNull(); // token rung refuses
  });

  it("an exact phrase outranks a token match of equal tier", () => {
    const bank = [
      entry({ id: "tok", questionPatterns: ["require visa sponsorship now"] }),
      entry({ id: "phr", questionPatterns: ["require visa sponsorship"] }),
    ];
    expect(matchAnswer("Will you require visa sponsorship?", bank)?.id).toBe("phr");
  });

  it("a user token-match still beats a derived phrase match", () => {
    const bank = [
      entry({ id: "derived", derived: true, questionPatterns: ["visa sponsorship"] }),
      entry({ id: "user", questionPatterns: ["require visa or sponsorship"] }),
    ];
    expect(matchAnswer("Do you require visa sponsorship?", bank)?.id).toBe("user");
  });
});

/**
 * The Equal Employment answers, as the profile page stores them, against the
 * wording real applications use.
 *
 * A user's EEO answers were destroyed by a UI that listed them twice, and the
 * next application had nothing to fill in for work authorization or disability.
 * The matching was never the fault — it was measured and it was right — but it
 * is the half of this that no screenshot would ever catch again, so it is
 * pinned here.
 *
 * The patterns below are copied from the profile page's EEO presets
 * (`apps/web/src/components/profile/eeo-editor.tsx`, whose exact set that
 * file's own tests hold). They are duplicated rather than imported because this
 * package must not depend on the app. The people are invented.
 */
describe("the EEO preset answers, against how real forms word the question", () => {
  const eeoBank: AnswerEntry[] = [
    {
      id: "authorization",
      answer: "Yes",
      type: "enum",
      category: "eeo",
      questionPatterns: [
        "Are you authorized to work in the US?",
        "authorized to work",
        "legally authorized",
        "eligible to work",
        "work authorization",
      ],
    },
    {
      id: "disability",
      answer: "I do not want to answer",
      type: "enum",
      category: "eeo",
      questionPatterns: ["Do you have a disability?", "disability"],
    },
    {
      id: "sponsorship",
      answer: "No",
      type: "enum",
      category: "eeo",
      questionPatterns: [
        "Will you now or in the future require sponsorship for employment visa status?",
        "sponsorship",
        "visa status",
      ],
    },
  ];

  it("answers the authorization question however the form phrases it", () => {
    for (const question of [
      "Are you legally authorized to work in the U.S.?",
      "Are you eligible to work in the United States?",
      "Work authorization",
    ]) {
      expect(matchAnswer(question, eeoBank)?.id, question).toBe("authorization");
    }
  });

  it("answers the disability self-identification section by its formal title", () => {
    expect(matchAnswer("Voluntary Self-Identification of Disability", eeoBank)?.id).toBe(
      "disability",
    );
  });

  it("does not confuse sponsorship with authorization — they are opposite answers", () => {
    // "Yes, I can work here" and "No, I need no sponsorship" are both true and
    // swapping them is a false statement on an application.
    expect(
      matchAnswer(
        "Will you now or in the future require sponsorship for employment visa status?",
        eeoBank,
      )?.id,
    ).toBe("sponsorship");
  });
});
