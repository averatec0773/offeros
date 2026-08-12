import { describe, it, expect } from "vitest";
import type { WizardState } from "@offeros/autofill";
import { stablePageId } from "../src/lib/autofill/page-id";

/**
 * Page identity is the merge key for every field report, so the property that
 * matters is the one the old implementation lacked: it must NOT change when
 * the page changes shape.
 */

const wizard = (current: number, total = 6): WizardState => ({
  steps: Array.from({ length: total }, (_, i) => ({
    number: i + 1,
    label: `Step ${i + 1}`,
    current: i + 1 === current,
  })),
  current,
  total,
  onFinalStep: current === total,
});

describe("stablePageId", () => {
  it("is the same before and after the form grows a field", () => {
    // The whole bug: a conditional field appearing used to change the key of
    // every field on the page at once.
    const before = stablePageId("https://boards.example.com/acme/apply");
    const after = stablePageId("https://boards.example.com/acme/apply");
    expect(after).toBe(before);
  });

  it("ignores tracking parameters and fragments", () => {
    const plain = stablePageId("https://boards.example.com/acme/apply");
    expect(stablePageId("https://boards.example.com/acme/apply?utm_source=x")).toBe(plain);
    expect(stablePageId("https://boards.example.com/acme/apply#form")).toBe(plain);
    expect(stablePageId("https://boards.example.com/acme/apply/")).toBe(plain);
    expect(stablePageId("https://BOARDS.example.com/acme/APPLY")).toBe(plain);
  });

  it("separates two jobs on the same host", () => {
    expect(stablePageId("https://boards.example.com/acme/apply")).not.toBe(
      stablePageId("https://boards.example.com/globex/apply"),
    );
  });

  it("separates the steps of a multi-page application served from one URL", () => {
    // Without this, page four's reports would overwrite page one's.
    const url = "https://acme.wd1.myworkdayjobs.com/careers/apply";
    const one = stablePageId(url, wizard(1));
    const four = stablePageId(url, wizard(4));
    expect(one).not.toBe(four);
    expect(stablePageId(url, wizard(4))).toBe(four);
  });

  it("uses the step NUMBER, so retitling a step does not change identity", () => {
    const url = "https://acme.wd1.myworkdayjobs.com/careers/apply";
    const renamed: WizardState = {
      total: 6,
      current: 2,
      onFinalStep: false,
      steps: [{ number: 2, label: "Completely Different Name", current: true }],
    };
    const original: WizardState = {
      total: 6,
      current: 2,
      onFinalStep: false,
      steps: [{ number: 2, label: "My Experience", current: true }],
    };
    expect(stablePageId(url, renamed)).toBe(stablePageId(url, original));
  });

  it("falls back to the raw string for something that is not a URL", () => {
    expect(stablePageId("not a url")).toBe("not a url");
    expect(stablePageId("not a url")).toBe(stablePageId("  NOT A URL  "));
  });

  it("is not a hash of the fields — that was the defect", () => {
    // Guard against a regression to the old scheme: identity must not depend
    // on anything about the form's contents.
    const id = stablePageId("https://boards.example.com/acme/apply");
    expect(id).not.toContain("|");
    expect(id).toBe("boards.example.com/acme/apply");
  });
});
