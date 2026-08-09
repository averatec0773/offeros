import { describe, expect, it } from "vitest";
import { guardClassOf, isAutoAnswerForbidden, needsPostFillReview } from "../guards";

describe("guardClassOf", () => {
  it("classifies voluntary self-identification as sensitive, in either lane", () => {
    // Same question, two renderings — the guard must not depend on the widget.
    expect(guardClassOf({ label: "What is your gender identity?" })).toBe("sensitive");
    expect(
      guardClassOf({ label: "Please describe any disability or accommodation you need." }),
    ).toBe("sensitive");
    expect(
      guardClassOf({ label: "Veteran Status", options: ["I am not a protected veteran"] }),
    ).toBe("sensitive");
  });

  it("catches a neutral question whose OPTIONS are the sensitive part", () => {
    // Observed live: the question reads innocuous, the choices do not.
    expect(
      guardClassOf({
        label: "Which of the following communities do you belong to?",
        options: ["Person with disability", "Veteran", "None of the above"],
      }),
    ).toBe("sensitive");
  });

  it("classifies work-authorization and sponsorship as truth-required", () => {
    expect(guardClassOf({ label: "Are you authorized to work in the United States?" })).toBe(
      "truth",
    );
    expect(guardClassOf({ label: "Will you now or in the future require visa sponsorship?" })).toBe(
      "truth",
    );
    expect(guardClassOf({ label: "Are you legally eligible to work in the US?" })).toBe("truth");
  });

  it("classifies acknowledgments and consents as policy", () => {
    expect(
      guardClassOf({
        label:
          "Do you acknowledge and agree to comply with our AI policy during the interview process?",
      }),
    ).toBe("policy");
    expect(guardClassOf({ label: "View our privacy policy here: Privacy Policy" })).toBe("policy");
    expect(guardClassOf({ label: "I have read the terms and conditions" })).toBe("policy");
  });

  it("leaves ordinary questions unguarded", () => {
    expect(guardClassOf({ label: "Why do you want to work here?" })).toBeNull();
    expect(
      guardClassOf({ label: "How frequently did you use Python in the past year?" }),
    ).toBeNull();
    expect(guardClassOf({ label: "Where did you hear about this job?" })).toBeNull();
  });

  it("gives a question that reads as several the most restrictive class", () => {
    // Sensitive beats truth beats policy — the guard never softens.
    expect(guardClassOf({ label: "Do you consent to sharing your veteran status with us?" })).toBe(
      "sensitive",
    );
    expect(
      guardClassOf({ label: "I acknowledge that I am authorized to work in the United States" }),
    ).toBe("truth");
  });
});

describe("handling rules", () => {
  it("forbids automated answers for sensitive and truth, allows policy", () => {
    expect(isAutoAnswerForbidden({ label: "What is your gender?" })).toBe(true);
    expect(isAutoAnswerForbidden({ label: "Do you require visa sponsorship?" })).toBe(true);
    expect(isAutoAnswerForbidden({ label: "Do you agree to the AI use policy?" })).toBe(false);
    expect(isAutoAnswerForbidden({ label: "Why this company?" })).toBe(false);
  });

  it("marks only policy answers for post-fill review", () => {
    expect(needsPostFillReview({ label: "Do you agree to the AI use policy?" })).toBe(true);
    expect(needsPostFillReview({ label: "What is your gender?" })).toBe(false);
    expect(needsPostFillReview({ label: "Why this company?" })).toBe(false);
  });
});
