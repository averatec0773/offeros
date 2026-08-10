// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { findAdvanceButton, readWizard } from "../../src/lib/autofill/wizard-dom";

/** The bar's markup, in the shape Workday renders it. */
function progressBar(entries: string[]): void {
  document.body.innerHTML = `<div data-automation-id="progressBar">${entries
    .map((t) => `<div><span>${t}</span></div>`)
    .join("")}</div>`;
}

describe("readWizard", () => {
  it("reads the position off Workday's progress bar", () => {
    progressBar([
      "step 1 of 7",
      "Create Account/Sign In",
      "current step 2 of 7",
      "My Information",
      "step 3 of 7",
      "My Experience",
    ]);
    const state = readWizard(document)!;
    expect(state.current).toBe(2);
    expect(state.total).toBe(7);
  });

  it("returns null on a page with no progress bar", () => {
    // Every single-page form. Not a wizard is not a failure.
    document.body.innerHTML = `<form><input name="email"></form>`;
    expect(readWizard(document)).toBeNull();
  });
});

describe("findAdvanceButton", () => {
  it("finds the button that moves to the next page", () => {
    document.body.innerHTML = `<button>Back</button><button>Save and Continue</button>`;
    expect(findAdvanceButton(document)?.textContent).toBe("Save and Continue");
  });

  /**
   * The rule this file exists for. On the last page the continue button IS the
   * submit button, and pressing it sends the application. Nothing that
   * automates a wizard may press it, so the match is on the words rather than
   * on position or id — the words are what tell the two apart.
   */
  it("never returns a button that could submit", () => {
    for (const label of ["Submit", "Submit Application", "Apply Now", "Send application"]) {
      document.body.innerHTML = `<button>${label}</button>`;
      expect(findAdvanceButton(document), label).toBeNull();
    }
  });

  it("refuses a button whose label merely contains the word continue", () => {
    // "Continue to submit" is a submit button wearing a continue label.
    document.body.innerHTML = `<button>Continue to submit</button>`;
    expect(findAdvanceButton(document)).toBeNull();
  });
});
