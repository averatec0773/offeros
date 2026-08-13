import { describe, expect, it } from "vitest";
import {
  isPlaceholderPhone,
  isPlaceholderText,
  isPlaceholderValue,
  pageValueState,
  valuesAgree,
} from "../placeholder";

/**
 * The distinction an application went out without.
 *
 * Every Equal Employment question showed "-None-", the salutation showed
 * "-None-", the phone field showed the dial code of the country it had
 * defaulted to — and all of them were reported filled, with the placeholder as
 * the value, while the applicant's real answers stayed in their profile. A
 * control showing text is not a control that has been answered.
 */

describe("what a form shows when nothing has been chosen", () => {
  it("recognises the usual ways of saying nothing", () => {
    for (const value of [
      "",
      "   ",
      "-None-",
      "none",
      "NONE",
      "Unknown",
      "N/A",
      "Select…",
      "Select...",
      "Select one",
      "Please select",
      "Choose an option",
      "--",
      "-- Select --",
      "...",
    ]) {
      expect(isPlaceholderText(value), value).toBe(true);
    }
  });

  it("leaves real answers alone, including ones that resemble a placeholder", () => {
    for (const value of [
      "None of the above",
      "Unknown Pleasures",
      "Select Board Member",
      "Selected Works",
      "Chooser",
      "No",
      "Yes",
      "Jordan Rivera",
      "Prefer not to say",
      "I do not want to answer",
      "Decline to self-identify",
    ]) {
      expect(isPlaceholderText(value), value).toBe(false);
    }
  });

  // "Prefer not to say" and "Decline to self-identify" deserve their own line:
  // they are answers a person deliberately gives, and treating one as an empty
  // control would overwrite a considered choice about their own identity.
  it("treats a declared refusal as the answer it is", () => {
    expect(isPlaceholderText("Prefer not to say")).toBe(false);
    expect(isPlaceholderText("I don't wish to answer")).toBe(false);
  });
});

describe("a phone field showing only where it defaulted to", () => {
  it("knows a dial code is not a phone number", () => {
    for (const value of ["United States+1", "+1", "+44", "🇺🇸 +1", "+1 ()", ""]) {
      expect(isPlaceholderPhone(value), value).toBe(true);
    }
  });

  it("knows a phone number when it sees one", () => {
    for (const value of ["+1 555 0100", "5550100", "(555) 010-0199", "+44 20 7946 0958"]) {
      expect(isPlaceholderPhone(value), value).toBe(false);
    }
  });

  it("routes phone-ish fields to the phone rule", () => {
    // "United States+1" is not in any word list and never could be — the
    // country name varies. It has to be judged as a phone number.
    expect(isPlaceholderValue("United States+1", "phone")).toBe(true);
    expect(isPlaceholderValue("United States+1")).toBe(false);
  });
});

describe("agreeing about a value", () => {
  it("forgives reformatting", () => {
    expect(valuesAgree("(555) 123-4567", "5551234567")).toBe(true);
    expect(valuesAgree("jordan@example.com", "Jordan@Example.com")).toBe(true);
  });

  it("does not forgive rewording", () => {
    expect(valuesAgree("United States", "United States of America")).toBe(false);
    expect(valuesAgree("Yes", "No")).toBe(false);
    expect(valuesAgree("", "Yes")).toBe(false);
  });
});

describe("what the page is doing with a field", () => {
  const ours = "I am not a protected veteran";

  it("empty is empty", () => {
    expect(pageValueState({ currentValue: "" }, ours)).toBe("empty");
  });

  it("a placeholder is not an answer", () => {
    expect(pageValueState({ currentValue: "-None-" }, ours)).toBe("placeholder");
  });

  it("the DOM's own word beats any text pattern", () => {
    // A select resting on a prompt row whose text happens to read like a real
    // option. The structural evidence decides.
    expect(
      pageValueState({ currentValue: "Veteran status", currentValueIsPlaceholder: true }, ours),
    ).toBe("placeholder");
  });

  it("the DOM's own word beats the text pattern the OTHER way too", () => {
    // The half that was missing. A real answer that happens to be spelled like
    // a placeholder — "Unknown" is a genuine option on veteran-status
    // questions, "N/A" is what people type into optional boxes — must survive.
    // Reading only the `true` half let the wordlist erase exactly the answers
    // it exists to protect.
    expect(
      pageValueState({ currentValue: "Unknown", currentValueIsPlaceholder: false }, ours),
    ).toBe("differs");
    expect(pageValueState({ currentValue: "N/A", currentValueIsPlaceholder: false }, ours)).toBe(
      "differs",
    );
    expect(pageValueState({ currentValue: "None", currentValueIsPlaceholder: false }, ours)).toBe(
      "differs",
    );
  });

  it("holding what we would have written is agreement, not a conflict", () => {
    expect(pageValueState({ currentValue: ours }, ours)).toBe("agrees");
  });

  it("holding something else is a difference to show, not to resolve", () => {
    // Could be the applicant's typing, could be the site's own résumé parse.
    // Nothing in the DOM tells them apart, so this state means "ask", never
    // "overwrite" and never "skip quietly".
    expect(pageValueState({ currentValue: "I don't wish to answer" }, ours)).toBe("differs");
  });
});
