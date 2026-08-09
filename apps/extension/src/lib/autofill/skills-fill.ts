// Skills typeahead fill loop — the multi-tag capability at the center of the
// Skills autofill. For each resume skill it types into the ATS's skills
// input, waits for the async suggestion list, and selects the option ONLY when
// its text actually matches the skill. Improvements over a naive approach:
//   • pierces shadow DOM (Workday's ui5 skill picker keeps input + options in
//     shadow roots), so it works where a light-DOM query finds nothing;
//   • polls for suggestions instead of a fixed delay (more stable on slow ATS);
//   • verifies the option text against the skill (+ synonym candidates) before
//     clicking, so "C" is never mis-tagged as "C++";
//   • reports skipped skills truthfully instead of silently moving on.

import { deepQuery, deepQueryAll } from "./deep-query";
import { pickSkillMatch, skillCandidates } from "@offeros/autofill";

export interface SkillsFillResult {
  filled: string[];
  skipped: string[];
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function ownerWindow(el: Element): typeof globalThis {
  return (el.ownerDocument.defaultView as unknown as typeof globalThis) ?? globalThis;
}

function setNativeValue(input: HTMLInputElement, value: string): void {
  const win = ownerWindow(input);
  const proto = (win as unknown as { HTMLInputElement: typeof HTMLInputElement }).HTMLInputElement
    .prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(
    new (win as unknown as { Event: typeof Event }).Event("input", { bubbles: true }),
  );
}

function optionText(el: Element): string {
  return (el.textContent ?? "").trim();
}

export async function fillSkills(host: Element, skills: string[]): Promise<SkillsFillResult> {
  const settleMs = 800;
  const pollMs = 25;
  const filled: string[] = [];
  const skipped: string[] = [];

  const input = deepQuery(host, "input");
  if (!(input instanceof HTMLInputElement)) {
    return { filled, skipped: [...skills] };
  }

  for (const skill of skills) {
    input.focus();
    setNativeValue(input, skill);

    // Poll for the async suggestion list rather than a fixed sleep.
    let options: Element[] = [];
    const start = performance.now();
    do {
      await delay(pollMs);
      options = deepQueryAll(host, '[role="option"]');
    } while (options.length === 0 && performance.now() - start < settleMs);

    const match = pickSkillMatch(skillCandidates(skill), options.map(optionText));
    if (!match) {
      skipped.push(skill);
      setNativeValue(input, "");
      continue;
    }
    (options[match.index] as HTMLElement).click();
    filled.push(skill);
    await delay(pollMs);
  }

  return { filled, skipped };
}
