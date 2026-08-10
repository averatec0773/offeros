/**
 * Where a multi-page application is up to.
 *
 * Single-page forms (Ashby, Greenhouse) are one scan and one fill. Workday
 * splits an application across seven pages — sign in, your information, your
 * experience, questions, disclosures, self-identify, review — and the later
 * ones do not exist in the DOM until the current one is submitted. So "did the
 * fill finish" stops meaning "are the fields on this page filled", and a panel
 * that cannot tell those apart reports success in the middle of an application.
 *
 * Workday announces its position for screen readers, in a progress bar whose
 * text runs "current step 2 of 7" then the step's name. That is an exact
 * statement of where the user is, so reading it is a parse rather than a guess.
 * This module does the parse; getting the strings off the page is the
 * extension's job.
 */

export interface WizardStep {
  /** 1-based, as the page states it. */
  number: number;
  label: string;
  current: boolean;
}

export interface WizardState {
  steps: WizardStep[];
  /** 1-based number of the step being shown. */
  current: number;
  total: number;
  /** True on the last step, where "continue" means "submit" and the panel must
   *  not press anything. */
  onFinalStep: boolean;
}

/** "current step 2 of 7" / "step 3 of 7" — the position announcement. */
const POSITION = /^(current\s+)?step\s+(\d+)\s+of\s+(\d+)$/i;

/**
 * Read the state out of a progress bar's text, in document order.
 *
 * The announcement and the human-readable name are separate text nodes, the
 * announcement first, so each position is paired with whatever follows it. A
 * position with no name after it still counts — losing a step would make the
 * totals disagree with the page.
 *
 * Returns null when the text holds no positions at all, which is every
 * single-page form. Callers treat that as "not a wizard" rather than as an
 * error.
 */
export function readWizardState(texts: readonly string[]): WizardState | null {
  const steps: WizardStep[] = [];
  let total = 0;
  for (let i = 0; i < texts.length; i++) {
    const match = POSITION.exec(texts[i]!.trim());
    if (!match) continue;
    const number = Number(match[2]);
    total = Number(match[3]);
    const next = texts[i + 1]?.trim() ?? "";
    // The next node is a name only if it is not itself a position.
    const label = POSITION.test(next) ? "" : next;
    steps.push({ number, label, current: Boolean(match[1]) });
  }
  if (steps.length === 0) return null;
  const current = steps.find((s) => s.current)?.number ?? steps[0]!.number;
  return {
    steps,
    current,
    // Trust the page's own "of N" over the number of steps parsed: a bar that
    // renders lazily can show fewer entries than it says it has.
    total: Math.max(total, steps.length),
    onFinalStep: current >= Math.max(total, steps.length),
  };
}

/**
 * Whether this page is worth advancing from.
 *
 * Advancing means pressing the page's own continue button, and on the last step
 * that button submits the application — which is the user's to press. Nothing
 * that automates a wizard may treat the final step as just another page.
 */
export function canAdvance(state: WizardState | null): boolean {
  return state !== null && !state.onFinalStep;
}

/** How far along, for a panel that wants to say "step 3 of 7 — Questions". */
export function describeWizard(state: WizardState): string {
  const here = state.steps.find((s) => s.current);
  const name = here?.label ? ` — ${here.label}` : "";
  return `Step ${state.current} of ${state.total}${name}`;
}
