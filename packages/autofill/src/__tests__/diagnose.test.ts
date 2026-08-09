import { describe, expect, it } from "vitest";
import { diagnoseFill, type DiagnosableField } from "../diagnose";

/**
 * The rows below are copied out of a real fill report in the owner's database
 * (a Greenhouse form, 73 fields, 23 filled), not composed for the test. That
 * matters here more than usual: the whole function is a lookup over reason
 * strings our own engine writes, so a fixture that invents those strings would
 * be testing a vocabulary nobody uses.
 */
const REAL: DiagnosableField[] = [
  {
    label: "Country",
    outcome: "failed",
    source: "personal",
    required: false,
    reason: "classified 'country' → filled from profile.personal.country",
  },
  {
    label: "Attach",
    outcome: "needs-user",
    source: "personal",
    required: false,
    reason: "file input → always manual upload, left needs-answer",
  },
  {
    label: "",
    outcome: "needs-user",
    source: "personal",
    required: false,
    reason: "file input → always manual upload, left needs-answer",
  },
  {
    label: "Are you legally eligible to work in the U.S.?",
    outcome: "needs-user",
    source: "ai-generated",
    required: true,
    reason: "no classifier or answer-bank match, open-ended question → offered for AI",
  },
  {
    label: "Will you now or in the future require visa sponsorship?",
    outcome: "needs-user",
    source: "ai-generated",
    required: true,
    reason: "no classifier or answer-bank match, open-ended question → offered for AI",
  },
  {
    label: "Yes - I consent to receiving text messages",
    outcome: "needs-user",
    source: "ai-generated",
    required: false,
    reason: "no classifier or answer-bank match, open-ended question → offered for AI",
  },
  {
    label: "Austin Office",
    outcome: "needs-user",
    source: "none",
    required: false,
    reason: "no classifier match → left unknown",
  },
  {
    label: "Remote (U.S.)",
    outcome: "needs-user",
    source: "none",
    required: false,
    reason: "no classifier match → left unknown",
  },
  { label: "First name", outcome: "filled", source: "personal", required: true, reason: "profile" },
  { label: "Email", outcome: "filled", source: "personal", required: true, reason: "profile" },
  {
    label: "Search",
    outcome: "skipped",
    source: "none",
    required: false,
    reason: "not a question",
  },
];

describe("diagnoseFill", () => {
  const diagnosis = diagnoseFill(REAL);

  it("counts outcomes without folding skipped fields into failures", () => {
    // Skipped is the engine deciding a control is not a question. Counting it
    // as a failure would make every form look broken.
    expect(diagnosis.total).toBe(11);
    expect(diagnosis.filled).toBe(2);
    expect(diagnosis.skipped).toBe(1);
  });

  it("turns eight failed fields into four causes", () => {
    // The point of the whole function: a wall of rows becomes a to-do list.
    expect(diagnosis.causes.map((c) => c.cause)).toEqual([
      "needs-your-answer",
      "write-rejected",
      "not-recognised",
      "manual-upload",
    ]);
  });

  it("puts what the user can act on before what only a developer can", () => {
    const order = diagnosis.causes.map((c) => c.cause);
    expect(order.indexOf("needs-your-answer")).toBeLessThan(order.indexOf("not-recognised"));
    // And "working as designed" comes last, so it never leads.
    expect(order.at(-1)).toBe("manual-upload");
  });

  it("says how many of each cause are required", () => {
    // Two of the three unanswered questions block submission; the SMS consent
    // does not. Without this the user cannot tell urgent from tidy-up.
    const unanswered = diagnosis.causes.find((c) => c.cause === "needs-your-answer")!;
    expect(unanswered.fields).toHaveLength(3);
    expect(unanswered.requiredCount).toBe(2);
  });

  it("names a field that has no label rather than dropping it", () => {
    // Silently omitting it would make the names disagree with the counts.
    const uploads = diagnosis.causes.find((c) => c.cause === "manual-upload")!;
    expect(uploads.fields).toEqual(["Attach", "(unlabelled field)"]);
  });

  it("separates a value the page rejected from a field nobody understood", () => {
    // Country was classified and a value was chosen — the write is what failed.
    // That is a defect. "Austin Office" was never understood, which is a
    // coverage gap. Same red row in the UI, opposite fixes.
    const rejected = diagnosis.causes.find((c) => c.cause === "write-rejected")!;
    expect(rejected.fields).toEqual(["Country"]);
    const unknown = diagnosis.causes.find((c) => c.cause === "not-recognised")!;
    expect(unknown.fields).toEqual(["Austin Office", "Remote (U.S.)"]);
  });

  it("reports a guard refusal as its own cause, ahead of everything else", () => {
    // A guard refusing is the feature working. It must never read as a bug,
    // and the user should see it first because it is the one needing a person.
    const guarded = diagnoseFill([
      {
        label: "Are you authorized to work in the US?",
        outcome: "needs-user",
        source: "none",
        required: true,
        reason: "guard: only you can answer this",
      },
      ...REAL,
    ]);
    expect(guarded.causes[0]!.cause).toBe("only-you-can-answer");
  });

  it("returns no causes for a form that filled completely", () => {
    expect(diagnoseFill(REAL.filter((f) => f.outcome === "filled")).causes).toEqual([]);
  });

  /**
   * Every phrasing `buildFillPlan` actually emits, from fill-plan.ts. Tying the
   * lookup to one example missed the empty-stored-answer case and filed a
   * question the user could answer as one nobody understood — opposite advice.
   */
  it("covers every reason the planner writes", () => {
    const rows: [string, string][] = [
      [
        'answer-bank pattern matched label "Notice period" but stored answer is empty → needs-answer',
        "needs-your-answer",
      ],
      [
        "no classifier or answer-bank match, open-ended question → offered for per-field generation",
        "needs-your-answer",
      ],
      ["no classifier match → left unknown", "not-recognised"],
      ["file input → always manual upload, left needs-answer", "manual-upload"],
    ];
    for (const [reason, expected] of rows) {
      const out = diagnoseFill([
        { label: "q", outcome: "needs-user", source: "none", required: false, reason },
      ]);
      expect(out.causes[0]!.cause, reason).toBe(expected);
    }
  });

  it("survives an empty report", () => {
    expect(diagnoseFill([])).toEqual({ total: 0, filled: 0, skipped: 0, causes: [] });
  });
});
