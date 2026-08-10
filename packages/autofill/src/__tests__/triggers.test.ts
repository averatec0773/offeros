import { describe, expect, it } from "vitest";
import {
  detectIncidents,
  requiredCoverage,
  isPreventableFailure,
  type TriggerField,
} from "../triggers";

/** Reason strings the planner actually writes (see fill-plan.ts). */
const R = {
  unknown: "no classifier match → left unknown",
  open: "no classifier or answer-bank match, open-ended question → offered for generation",
  guard: "a guard refused to answer for you",
  upload: "file input → always manual upload, left needs-answer",
  chose: "classified 'country' → filled from profile.personal.country",
};

const field = (over: Partial<TriggerField> = {}): TriggerField => ({
  label: "q",
  outcome: "needs-user",
  reason: R.unknown,
  source: "none",
  required: false,
  questionKey: "k1",
  ...over,
});

const none = { seen: new Set<string>(), failedBefore: new Set<string>(), formIsNew: true };

describe("detectIncidents", () => {
  /**
   * The premise of the whole design: most fills cost nothing. If this fires on
   * ordinary forms the budget goes on admiring the guard rails.
   */
  it("does not fire on a form where the engine did its job", () => {
    const incidents = detectIncidents({
      fields: [
        field({ outcome: "filled", reason: R.chose, required: true }),
        field({ reason: R.guard, required: true, questionKey: "k2" }),
        field({ reason: R.upload, questionKey: "k3" }),
        field({ reason: R.open, required: true, questionKey: "k4" }),
      ],
      ...none,
    });
    expect(incidents).toEqual([]);
  });

  it("fires on a required question it has never seen and cannot classify", () => {
    const incidents = detectIncidents({
      fields: [
        field({ outcome: "filled", reason: R.chose, required: true, questionKey: "ok" }),
        field({ required: true, questionKey: "new-one" }),
      ],
      ...none,
    });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      trigger: "unrecognised-required",
      questionKeys: ["new-one"],
    });
  });

  it("does not fire again for a question already recorded", () => {
    const incidents = detectIncidents({
      fields: [field({ required: true, questionKey: "old" })],
      ...none,
      seen: new Set(["old"]),
    });
    expect(incidents).toEqual([]);
  });

  it("fires on a refused value even on a form it knows well", () => {
    // A value chosen and rejected is a regression on something that worked.
    // Novelty is irrelevant, so this must not be gated on `seen`.
    const incidents = detectIncidents({
      fields: [field({ outcome: "failed", source: "personal", reason: R.chose, questionKey: "c" })],
      seen: new Set(["c"]),
      failedBefore: new Set(),
      formIsNew: false,
    });
    expect(incidents[0]).toMatchObject({ trigger: "write-rejected", questionKeys: ["c"] });
  });

  it("puts a regression ahead of a novelty", () => {
    // Both are real; the one that used to work is the more urgent.
    const incidents = detectIncidents({
      fields: [
        field({ required: true, questionKey: "novel" }),
        field({ outcome: "failed", source: "personal", reason: R.chose, questionKey: "broke" }),
      ],
      ...none,
    });
    expect(incidents.map((i) => i.trigger)).toEqual(["write-rejected", "unrecognised-required"]);
  });

  it("fires on a question that also failed elsewhere, even when optional", () => {
    // Optional questions never trip the required trigger, so without this an
    // office-location question appearing on every form is ignored forever.
    const incidents = detectIncidents({
      fields: [field({ required: false, questionKey: "everywhere" })],
      seen: new Set(["everywhere"]),
      failedBefore: new Set(["everywhere"]),
      formIsNew: false,
    });
    expect(incidents[0]).toMatchObject({ trigger: "repeat-offender" });
  });

  it("analyses a question once per fill, whichever trigger claimed it", () => {
    const incidents = detectIncidents({
      fields: [field({ required: true, questionKey: "both" })],
      seen: new Set(),
      failedBefore: new Set(["both"]),
      formIsNew: true,
    });
    const keys = incidents.flatMap((i) => i.questionKeys);
    expect(keys).toEqual(["both"]);
  });

  it("fires on a form it broadly failed, and only when nothing else did", () => {
    const badForm = Array.from({ length: 10 }, (_, i) =>
      field({ required: true, questionKey: `q${i}`, reason: R.unknown }),
    );
    // Every question here is unrecognised AND required, so the specific trigger
    // claims them first — the cliff must not fire on top and pay twice.
    const withSpecific = detectIncidents({ fields: badForm, ...none });
    expect(withSpecific.map((i) => i.trigger)).toEqual(["unrecognised-required"]);

    // A form that failed broadly for reasons no specific trigger names.
    const vague = [
      field({ outcome: "filled", reason: R.chose, required: true, questionKey: "a" }),
      ...Array.from({ length: 4 }, (_, i) =>
        field({ required: true, questionKey: `v${i}`, reason: "left blank for unclear reasons" }),
      ),
    ];
    const cliff = detectIncidents({ fields: vague, ...none });
    expect(cliff[0]?.trigger).toBe("coverage-cliff");
  });

  it("carries at most five questions in one incident", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      field({ required: true, questionKey: `q${i}` }),
    );
    const incidents = detectIncidents({ fields: many, ...none });
    expect(incidents[0]!.questionKeys).toHaveLength(5);
  });
});

describe("requiredCoverage", () => {
  it("leaves out required fields the engine was never meant to fill", () => {
    // A required demographic question a guard refused must not drag the score
    // down — the fastest way to raise it would then be to weaken the guard.
    const coverage = requiredCoverage([
      field({ outcome: "filled", reason: R.chose, required: true }),
      field({ reason: R.guard, required: true }),
      field({ reason: R.upload, required: true }),
    ]);
    expect(coverage).toBe(1);
  });

  it("returns null when there is nothing to measure", () => {
    expect(requiredCoverage([])).toBeNull();
    expect(requiredCoverage([field({ required: false })])).toBeNull();
  });
});

describe("isPreventableFailure — outcome gates the reason text", () => {
  it("an AI-rescued FILLED field is not a failure, whatever its reason says", () => {
    // Live wave-1 case: generated answers carry "no classifier match" in the
    // reason; counting them as failures inflated failed_count 3 -> 5 on one
    // form and poisoned the recurrence denominator.
    expect(
      isPreventableFailure({
        label: "Tell us why",
        outcome: "filled",
        reason: "no classifier match → left unknown, AI answer accepted",
        source: "ai-generated",
        required: true,
      }),
    ).toBe(false);
  });

  it("an unfilled unrecognised field still counts", () => {
    expect(
      isPreventableFailure({
        label: "Mystery",
        outcome: "skipped",
        reason: "no classifier match → left unknown",
        source: "none",
        required: true,
      }),
    ).toBe(true);
  });
});
