import { readWizardState, type WizardState } from "@offeros/autofill";

/**
 * Find the multi-page position, if this page has one.
 *
 * Workday marks its progress bar with `data-automation-id="progressBar"` and
 * writes the position into it for screen readers ("current step 2 of 7"). Both
 * are stable hooks the vendor maintains for its own reasons, which is why this
 * reads them rather than matching on layout.
 */

const PROGRESS_BAR = '[data-automation-id="progressBar"]';

/** Text of every leaf node inside an element, in document order. */
function leafTexts(root: Element): string[] {
  return Array.from(root.querySelectorAll("*"))
    .filter((el) => el.children.length === 0)
    .map((el) => (el.textContent ?? "").trim())
    .filter((t) => t !== "");
}

export function readWizard(doc: Document): WizardState | null {
  const bar = doc.querySelector(PROGRESS_BAR);
  if (!bar) return null;
  return readWizardState(leafTexts(bar));
}

/**
 * The button that moves to the next page.
 *
 * Matched by its words rather than by an id, because the label is what tells
 * the two apart: "Save and Continue" advances, "Submit" ends the application.
 * Anything that could be a submit is refused — on the last page the continue
 * button IS the submit button, and pressing it is the user's to do.
 */
const ADVANCE_WORDS = /^(save and continue|continue|next)$/i;
const NEVER_PRESS = /submit|apply now|send/i;

export function findAdvanceButton(doc: Document): HTMLElement | null {
  const buttons = Array.from(doc.querySelectorAll<HTMLElement>('button,[role="button"]'));
  for (const button of buttons) {
    const label = (button.textContent ?? "").trim();
    if (!label || NEVER_PRESS.test(label)) continue;
    if (ADVANCE_WORDS.test(label)) return button;
  }
  return null;
}
