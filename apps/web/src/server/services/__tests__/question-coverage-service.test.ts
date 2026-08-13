import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ObservedQuestion } from "@offeros/core";
import { createDb, type Db } from "../../db/client";
import { saveProfile } from "../../repositories/profile-repo";
import { createAnswer } from "../../repositories/answer-repo";
import {
  answerGaps,
  buildCoverage,
  mergeObservations,
  preferFills,
} from "../question-coverage-service";
import type { QuestionSource } from "../question-sources";

/**
 * The seam this batch exists to establish.
 *
 * Sources say what forms asked; the read model says what it means; consumers
 * read the result and never touch the database. The tests that matter most
 * here are the ones about the SHAPE of that arrangement — a new source has to
 * be able to join without any layer above it changing — because that is the
 * property the next feature will depend on and the one a refactor can quietly
 * break.
 */

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-coverage-"));
  db = createDb(join(dir, "t.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const PROFILE = {
  personal: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "",
    address: "",
    links: {},
  },
  education: [],
  experience: [],
  skills: [],
};

const seen = (over: Partial<ObservedQuestion> = {}): ObservedQuestion => ({
  questionKey: "k1",
  question: "What is your notice period?",
  control: "text",
  required: true,
  origin: "fill",
  applicationId: "app-1",
  ...over,
});

/** A source that exists only in this file — the whole point of the test. */
const inventedSource = (rows: ObservedQuestion[]): QuestionSource => ({
  id: "invented",
  observe: () => rows,
});

describe("the source contract", () => {
  it("lets a source nobody has heard of contribute, with no change above it", () => {
    // Nothing in the read model, and nothing in any consumer, knows this
    // source exists. If this test ever needs a change elsewhere to pass, the
    // seam has stopped being a seam.
    const coverage = buildCoverage(
      db,
      {},
      { sources: [inventedSource([seen({ question: "Do you have a driving licence?" })])] },
    );
    expect(coverage.map((q) => q.question)).toEqual(["Do you have a driving licence?"]);
  });

  it("asks every registered source and pools what they return", () => {
    const coverage = buildCoverage(
      db,
      {},
      {
        sources: [
          inventedSource([seen({ questionKey: "a", question: "Notice period?" })]),
          inventedSource([seen({ questionKey: "b", question: "Expected salary?" })]),
        ],
      },
    );
    expect(coverage).toHaveLength(2);
  });

  it("passes the scope down so a source can narrow itself", () => {
    const scopes: unknown[] = [];
    const spy: QuestionSource = {
      id: "spy",
      observe: (_db, scope) => {
        scopes.push(scope);
        return [];
      },
    };
    buildCoverage(db, { applicationId: "app-9" }, { sources: [spy] });
    expect(scopes).toEqual([{ applicationId: "app-9" }]);
  });
});

describe("merging sightings", () => {
  it("counts one question once, however many times it was asked", () => {
    const merged = mergeObservations([
      seen({ applicationId: "app-1" }),
      seen({ applicationId: "app-2" }),
      seen({ applicationId: "app-2" }),
    ]);
    const row = merged.get("k1")!;
    expect(row.timesSeen).toBe(3);
    // Three sightings, two applications. Both numbers are true and they are
    // not the same number.
    expect(row.applications.size).toBe(2);
  });

  it("treats a question as required if any form required it", () => {
    const merged = mergeObservations([seen({ required: false }), seen({ required: true })]);
    expect(merged.get("k1")!.required).toBe(true);
  });

  it("prefers the wording of a form we actually met", () => {
    const merged = mergeObservations([
      seen({ origin: "prescan", question: "notice_period" }),
      seen({ origin: "fill", question: "What is your notice period?" }),
    ]);
    expect(merged.get("k1")!.question).toBe("What is your notice period?");
  });

  it("keeps sightings it cannot attribute out of the application count", () => {
    const merged = mergeObservations([seen({ applicationId: undefined })]);
    const row = merged.get("k1")!;
    expect(row.timesSeen).toBe(1);
    expect(row.applications.size).toBe(0);
  });
});

describe("a fill outranks a prescan, per application", () => {
  it("drops the advertised form for an application we actually filled", () => {
    const kept = preferFills([
      seen({ origin: "fill", applicationId: "app-1", questionKey: "a" }),
      seen({ origin: "prescan", applicationId: "app-1", questionKey: "b" }),
    ]);
    expect(kept.map((o) => o.questionKey)).toEqual(["a"]);
  });

  it("keeps the advertised form for an application nobody filled", () => {
    // Most applications are never filled; erasing their prescans would empty
    // the gaps list of exactly the questions it is for.
    const kept = preferFills([
      seen({ origin: "fill", applicationId: "app-1", questionKey: "a" }),
      seen({ origin: "prescan", applicationId: "app-2", questionKey: "b" }),
    ]);
    expect(kept.map((o) => o.questionKey).sort()).toEqual(["a", "b"]);
  });

  it("across everything, one filled field does not erase a half-done form", () => {
    // A fill is written incrementally: a wizard page never reached, a gate, an
    // "I applied" from screen two. Per-application authority threw away every
    // prescanned question for that application — including the ones the fill
    // never got to, which then left the gaps list altogether: not unanswered,
    // not ours, gone.
    const kept = preferFills(
      [
        seen({ origin: "fill", applicationId: "app-1", question: "Email" }),
        seen({ origin: "prescan", applicationId: "app-1", question: "Email" }),
        seen({ origin: "prescan", applicationId: "app-1", question: "Why this company?" }),
      ],
      true,
    );
    expect(kept.map((o) => `${o.origin} ${o.question}`).sort()).toEqual([
      "fill Email",
      "prescan Why this company?",
    ]);
  });

  it("matches the two on their words, because old reports cannot reproduce a key", () => {
    // A report written before reports carried a questionKey gets one
    // recomputed from a canonical field name and no option list — it can never
    // equal the key the live engine builds from the control's own type and its
    // real choices. Same question, two keys.
    const kept = preferFills(
      [
        seen({ origin: "fill", applicationId: "app-1", questionKey: "legacy", question: "Gender" }),
        seen({
          origin: "prescan",
          applicationId: "app-1",
          questionKey: "live",
          question: "Gender",
        }),
      ],
      true,
    );
    expect(kept.map((o) => o.origin)).toEqual(["fill"]);
  });
});

describe("the same question asked twice is one row", () => {
  it("collapses rows that differ only by key", () => {
    // The count this feature exists to get right is "how often were you asked
    // this". Split across two keys for the same words, it is wrong twice.
    const merged = mergeObservations([
      seen({ questionKey: "legacy", question: "Gender", applicationId: "app-1" }),
      seen({ questionKey: "live", question: "Gender", applicationId: "app-2" }),
    ]);
    expect(merged.size).toBe(1);
    const only = [...merged.values()][0]!;
    expect(only.timesSeen).toBe(2);
    expect([...only.applications].sort()).toEqual(["app-1", "app-2"]);
  });
});

describe("what the user can answer", () => {
  it("counts a saved answer as answered", () => {
    createAnswer(db, {
      questionPatterns: ["notice period"],
      answer: "Four weeks",
      type: "text",
      category: "custom",
    });
    const [row] = buildCoverage(db, {}, { sources: [inventedSource([seen()])] });
    expect(row!.state).toBe("answered");
  });

  it("counts a profile field as answered", () => {
    saveProfile(db, PROFILE);
    const [row] = buildCoverage(
      db,
      {},
      { sources: [inventedSource([seen({ question: "Email", control: "email" })])] },
    );
    expect(row!.state).toBe("answered");
  });

  it("marks an identity question as ours to refuse, not theirs to have missed", () => {
    const [row] = buildCoverage(
      db,
      {},
      {
        sources: [
          inventedSource([seen({ question: "Voluntary Self-Identification of Disability" })]),
        ],
      },
    );
    expect(row!.state).toBe("not-ours");
    expect(row!.guard).toBe("sensitive");
  });

  it("still calls a guarded question answered when the user HAS stored one", () => {
    // The guard stops OfferOS inventing an answer. It does not stop the user
    // giving one — Profile → Equal Employment writes exactly these — and
    // reporting their own stored answer as unanswerable would be wrong twice.
    createAnswer(db, {
      questionPatterns: ["Voluntary Self-Identification of Disability", "disability"],
      answer: "I do not want to answer",
      type: "enum",
      category: "eeo",
    });
    const [row] = buildCoverage(
      db,
      {},
      {
        sources: [
          inventedSource([seen({ question: "Voluntary Self-Identification of Disability" })]),
        ],
      },
    );
    expect(row!.state).toBe("answered");
  });
});

describe("the gaps list", () => {
  const rows = [
    seen({ questionKey: "one", question: "Q one", applicationId: "app-1" }),
    seen({ questionKey: "two", question: "Q two", applicationId: "app-1" }),
    seen({ questionKey: "two", question: "Q two", applicationId: "app-2" }),
    seen({ questionKey: "two", question: "Q two", applicationId: "app-3" }),
  ];

  it("puts what has cost the most time first", () => {
    const { gaps } = answerGaps(db, {}, { sources: [inventedSource(rows)] });
    expect(gaps.map((g) => g.question)).toEqual(["Q two", "Q one"]);
    expect(gaps[0]!.seenOnApplications).toBe(3);
  });

  it("reports the true total even when the list is capped", () => {
    const { gaps, total } = answerGaps(db, { limit: 1 }, { sources: [inventedSource(rows)] });
    expect(gaps).toHaveLength(1);
    expect(total).toBe(2);
  });

  it("keeps the questions OfferOS will not answer in their own group", () => {
    const { gaps, notOurs } = answerGaps(
      db,
      {},
      {
        sources: [
          inventedSource([
            seen({ questionKey: "g", question: "Are you a protected veteran?" }),
            seen({ questionKey: "n", question: "What is your notice period?" }),
          ]),
        ],
      },
    );
    expect(gaps.map((g) => g.question)).toEqual(["What is your notice period?"]);
    expect(notOurs.map((g) => g.question)).toEqual(["Are you a protected veteran?"]);
  });

  it("says when sightings could not be attributed, rather than understating quietly", () => {
    const { hasUnattributedSightings } = answerGaps(
      db,
      {},
      { sources: [inventedSource([seen({ applicationId: undefined })])] },
    );
    expect(hasUnattributedSightings).toBe(true);
  });
});
