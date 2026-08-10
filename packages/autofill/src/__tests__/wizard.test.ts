import { describe, expect, it } from "vitest";
import { canAdvance, describeWizard, readWizardState } from "../wizard";

/**
 * The strings below were read off NVIDIA's live Workday progress bar on
 * 2026-08-09, in document order, including the screen-reader announcements
 * that carry the position. Composing them by hand would test a format nobody
 * emits.
 */
const REAL = [
  "current step 1 of 7",
  "Create Account/Sign In",
  "step 2 of 7",
  "My Information",
  "step 3 of 7",
  "My Experience",
  "step 4 of 7",
  "Application Questions",
  "step 5 of 7",
  "Voluntary Disclosures",
  "step 6 of 7",
  "Self Identify",
  "step 7 of 7",
  "Review",
];

describe("readWizardState", () => {
  it("reads the position and the names out of the bar", () => {
    const state = readWizardState(REAL)!;
    expect(state.current).toBe(1);
    expect(state.total).toBe(7);
    expect(state.steps).toHaveLength(7);
    expect(state.steps[3]).toEqual({ number: 4, label: "Application Questions", current: false });
  });

  it("follows the current marker as the application moves", () => {
    const midway = REAL.map((t) =>
      t === "current step 1 of 7" ? "step 1 of 7" : t === "step 4 of 7" ? "current step 4 of 7" : t,
    );
    const state = readWizardState(midway)!;
    expect(state.current).toBe(4);
    expect(describeWizard(state)).toBe("Step 4 of 7 — Application Questions");
  });

  it("returns null for a single-page form", () => {
    // Every Ashby and Greenhouse form. Not a wizard is not an error.
    expect(readWizardState(["First name", "Email", "Submit application"])).toBeNull();
    expect(readWizardState([])).toBeNull();
  });

  it("will not advance from the last step", () => {
    // On step 7 the continue button submits, and submitting is the user's.
    const last = REAL.map((t) =>
      t === "current step 1 of 7" ? "step 1 of 7" : t === "step 7 of 7" ? "current step 7 of 7" : t,
    );
    const state = readWizardState(last)!;
    expect(state.onFinalStep).toBe(true);
    expect(canAdvance(state)).toBe(false);
    expect(canAdvance(readWizardState(REAL))).toBe(true);
    expect(canAdvance(null)).toBe(false);
  });

  it("trusts the page's own total over how many entries it rendered", () => {
    // A bar that renders lazily shows fewer entries than it says it has;
    // believing the count would report "step 2 of 2" mid-application.
    const partial = ["current step 2 of 7", "My Information", "step 3 of 7", "My Experience"];
    const state = readWizardState(partial)!;
    expect(state.total).toBe(7);
    expect(state.onFinalStep).toBe(false);
  });

  it("keeps a step whose name did not render", () => {
    // Dropping it would make the totals disagree with the page.
    const state = readWizardState(["current step 1 of 2", "step 2 of 2", "Review"])!;
    expect(state.steps).toHaveLength(2);
    expect(state.steps[0]!.label).toBe("");
  });
});
