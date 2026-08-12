import { describe, it, expect } from "vitest";
import type { FillProfile } from "@offeros/autofill";
import { isAutoAnswerForbidden } from "@offeros/autofill";
import type { ClassifyFieldInput, FieldMapping } from "@offeros/llm";
import { answerQuestionsOf, eligibleForFallback, resolveMappings } from "../field-classify-service";

/**
 * The half of the AI fallback classifier that decides what may actually happen.
 *
 * Everything the model says arrives here as a claim about what a field IS. What
 * these tests hold is that a claim is not permission: the guards run on the
 * field's own text and refuse regardless, values come from the profile rather
 * than from the model, and a claim that resolves to nothing leaves the field
 * honestly unknown instead of quietly filled.
 */

const profile: FillProfile = {
  personal: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "555-0142",
    address: "1 Example Way",
    city: "Springfield",
    country: "United States",
    links: { linkedin: "https://linkedin.com/in/example" },
  },
  skills: ["TypeScript"],
  education: [],
  experience: [],
  answerBank: [
    {
      id: "a1",
      questionPatterns: ["why do you want to work here"],
      answer: "Because the problem is interesting.",
      type: "text",
      category: "custom",
    },
    {
      id: "a2",
      questionPatterns: ["notice period"],
      answer: "",
      type: "text",
      category: "custom",
    },
  ],
};

const field = (over: Partial<ClassifyFieldInput> = {}): ClassifyFieldInput => ({
  fieldId: "f1",
  label: "Telefonnummer",
  type: "text",
  currentStatus: "unknown",
  ...over,
});

const mapping = (over: Partial<FieldMapping> = {}): FieldMapping => ({
  fieldId: "f1",
  mapping: "canonical",
  target: "phone",
  confidence: 0.9,
  reason: "asks for a phone number in German",
  ...over,
});

describe("resolving a mapping into something fillable", () => {
  it("fills from the profile, not from the model", () => {
    const [r] = resolveMappings([mapping()], [field()], profile);
    expect(r!.status).toBe("fillable");
    expect(r!.value).toBe("555-0142");
    expect(r!.source).toBe("personal");
    expect(r!.reason).toContain("AI matched");
  });

  it("resolves an answer-bank mapping to the stored answer", () => {
    const [r] = resolveMappings(
      [mapping({ mapping: "answer", target: "why do you want to work here" })],
      [field({ label: "Warum möchten Sie hier arbeiten?" })],
      profile,
    );
    expect(r!.status).toBe("fillable");
    expect(r!.value).toBe("Because the problem is interesting.");
    expect(r!.answerId).toBe("a1");
  });

  it("marks an open-ended question generatable rather than filling it", () => {
    const [r] = resolveMappings(
      [mapping({ mapping: "generate", target: undefined })],
      [field({ label: "Tell us about a project you are proud of", type: "textarea" })],
      profile,
    );
    expect(r!.status).toBe("needs-answer");
    expect(r!.source).toBe("generate");
    expect(r!.generatable).toBe(true);
    expect(r!.value).toBe("");
  });
});

describe("the guards run here, not on the model's say-so", () => {
  it("refuses a work-authorization field however confidently it was mapped", () => {
    const [r] = resolveMappings(
      [mapping({ mapping: "answer", target: "why do you want to work here", confidence: 1 })],
      [field({ label: "Are you legally authorized to work in the United States?" })],
      profile,
    );
    expect(r!.status).toBe("needs-answer");
    expect(r!.value).toBe("");
    expect(r!.blockedBy).toBe("truth");
    expect(r!.reason).toContain("only you can make");
  });

  it("refuses a self-identification field", () => {
    const [r] = resolveMappings(
      [mapping({ mapping: "canonical", target: "fullName" })],
      [field({ label: "Veteran status", type: "radio-group", options: ["Yes", "No"] })],
      profile,
    );
    expect(r!.blockedBy).toBe("sensitive");
    expect(r!.status).toBe("needs-answer");
    expect(r!.value).toBe("");
  });

  it("catches a guarded question that only its OPTIONS give away", () => {
    // The label says nothing; the options are a sponsorship question.
    const [r] = resolveMappings(
      [mapping({ mapping: "generate" })],
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
      profile,
    );
    expect(r!.blockedBy).toBe("truth");
    expect(r!.source).toBe("none");
  });
});

describe("the model may add a guard, never remove one", () => {
  it("blocks a work-authorization question the English regex cannot read", () => {
    // "Arbeitserlaubnis" is work authorization. The deterministic guard is an
    // English regex and does not match it — which is exactly the exposure this
    // whole feature creates, since it is what makes non-English forms fillable
    // in the first place.
    const subject = { label: "Arbeitserlaubnis", options: undefined };
    expect(isAutoAnswerForbidden(subject)).toBe(false);

    const [r] = resolveMappings(
      [mapping({ mapping: "canonical", target: "phone", guardHint: "truth" })],
      [field({ label: "Arbeitserlaubnis" })],
      profile,
    );
    expect(r!.status).toBe("needs-answer");
    expect(r!.value).toBe("");
    expect(r!.blockedBy).toBe("truth");
  });

  it("blocks a self-identification question in another language", () => {
    const [r] = resolveMappings(
      [mapping({ mapping: "generate", guardHint: "sensitive" })],
      [field({ label: "Geschlecht" })],
      profile,
    );
    expect(r!.blockedBy).toBe("sensitive");
  });

  it("a policy hint does NOT block — those may be filled, then shown", () => {
    // Owner decision, unchanged here: leaving a consent blank blocks the
    // submission, so it is filled and surfaced for review afterwards.
    const [r] = resolveMappings(
      [mapping({ mapping: "canonical", target: "phone", guardHint: "policy" })],
      [field({ label: "Telefonnummer" })],
      profile,
    );
    expect(r!.status).toBe("fillable");
    expect(r!.blockedBy).toBeUndefined();
  });

  it("cannot UNBLOCK a question the deterministic guard refuses", () => {
    // The model saying nothing about a guarded question must not read as
    // permission — the regex is checked first and its answer is never revisited.
    const [r] = resolveMappings(
      [mapping({ mapping: "canonical", target: "fullName", guardHint: undefined })],
      [field({ label: "Are you authorized to work in the United States?" })],
      profile,
    );
    expect(r!.blockedBy).toBe("truth");
    expect(r!.value).toBe("");
  });
});

describe("cannot-map stays honestly unknown", () => {
  it("leaves the field unknown and says why", () => {
    const [r] = resolveMappings(
      [mapping({ mapping: "cannot-map", target: undefined, reason: "the label is just a number" })],
      [field({ label: "Field 3" })],
      profile,
    );
    expect(r!.status).toBe("unknown");
    expect(r!.source).toBe("none");
    expect(r!.value).toBe("");
    expect(r!.reason).toContain("couldn't tell");
  });

  it("a hallucinated canonical target is inert", () => {
    const [r] = resolveMappings(
      [mapping({ target: "socialSecurityNumber" })],
      [field({ label: "SSN" })],
      profile,
    );
    expect(r!.status).toBe("unknown");
    expect(r!.value).toBe("");
  });

  it("a hallucinated answer target is inert", () => {
    const [r] = resolveMappings(
      [mapping({ mapping: "answer", target: "what is your favourite colour" })],
      [field()],
      profile,
    );
    expect(r!.status).toBe("unknown");
    expect(r!.value).toBe("");
  });

  it("a fieldId we never sent is dropped entirely", () => {
    // Otherwise a model could inject a row into a plan keyed by fieldId.
    const out = resolveMappings([mapping({ fieldId: "not-on-this-page" })], [field()], profile);
    expect(out).toHaveLength(0);
  });

  it("a canonical mapping onto an empty profile field asks the user instead", () => {
    const [r] = resolveMappings(
      [mapping({ target: "github" })],
      [field({ label: "GitHub" })],
      profile,
    );
    expect(r!.status).toBe("needs-answer");
    expect(r!.value).toBe("");
    expect(r!.reason).toContain("empty in your profile");
  });

  it("an answer-bank entry with no text is not a fill", () => {
    const [r] = resolveMappings(
      [mapping({ mapping: "answer", target: "notice period" })],
      [field({ label: "Notice period" })],
      profile,
    );
    expect(r!.status).toBe("unknown");
  });

  it("refuses to resolve file/multi-value canonicals through the fallback", () => {
    // These have their own drivers; a text write here would be a lie.
    for (const target of ["resume", "coverLetter", "skills"]) {
      const [r] = resolveMappings([mapping({ target })], [field()], profile);
      expect(r!.status, target).toBe("unknown");
    }
  });
});

describe("what gets sent at all", () => {
  it("only fields the deterministic engine gave up on", () => {
    expect(eligibleForFallback({ currentStatus: "unknown" })).toBe(true);
    // A field the engine already answered must not be re-litigated by a model.
    expect(eligibleForFallback({ currentStatus: "fillable" })).toBe(false);
    expect(eligibleForFallback({ currentStatus: "needs-answer" })).toBe(false);
  });

  it("sends the bank's questions, deduplicated, and never its answers", () => {
    const questions = answerQuestionsOf(profile);
    expect(questions).toContain("why do you want to work here");
    expect(questions).toContain("notice period");
    expect(questions.join(" ")).not.toContain("Because the problem is interesting");
  });
});
