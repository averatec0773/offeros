import {
  COMBOBOX_RESULT,
  isComboboxFillMsg,
  SKILLS_RESULT,
  isSkillsFillMsg,
} from "../src/lib/autofill/combobox-protocol";
import { matchOptionValue, type SelectOption } from "@offeros/autofill";
import { fillSkills } from "../src/lib/autofill/skills-fill";

// React fiber access — documented narrow cast, see plan Global Constraints.
interface FiberNode {
  return: FiberNode | null;
  stateNode: unknown;
}

interface SelectLike {
  selectOption?: (o: SelectOption) => void;
  props?: { options?: unknown };
}

function fiberSelect(input: HTMLInputElement, value: string): boolean {
  const key = Object.keys(input).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return false;
  let fiber = (input as unknown as Record<string, FiberNode | undefined>)[key] ?? null;
  for (let hops = 0; fiber && hops < 40; hops++) {
    const sn = fiber.stateNode as SelectLike | null;
    if (sn && typeof sn.selectOption === "function" && Array.isArray(sn.props?.options)) {
      const opt = matchOptionValue(sn.props.options as SelectOption[], value);
      if (!opt) return false;
      sn.selectOption(opt);
      return true;
    }
    fiber = fiber.return;
  }
  return false;
}

// After a select, react-select renders the choice into a *-single-value node.
// strict=true (DOM fallback) requires seeing it; strict=false (fiber path)
// tolerates non-react-select widgets that lack the node.
function verifyCommitted(input: HTMLInputElement, value: string, strict: boolean): boolean {
  const scope = input.closest('[class*="control"]')?.parentElement ?? input.parentElement ?? document.body;
  const single = scope.querySelector('[class*="single-value"], [class*="singleValue"]');
  if (!single) return !strict;
  const shown = (single.textContent ?? "").trim().toLowerCase();
  return shown !== "" && (shown.includes(value.trim().toLowerCase()) || value.trim().toLowerCase().includes(shown));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function domFallback(input: HTMLInputElement, value: string): Promise<boolean> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  for (let i = 0; i < 12; i++) {
    await sleep(150);
    const opts = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
    // Match via the shared matcher so ellipsis-truncated (Workday) and
    // punctuation-varied option labels resolve, not just exact/substring.
    const matched = matchOptionValue(
      opts.map((o, idx) => ({ label: o.textContent ?? "", value: idx })),
      value,
    );
    const hit = matched && typeof matched.value === "number" ? opts[matched.value] : undefined;
    if (hit) {
      // value-control interaction only — never a submit control (see Global Constraints)
      hit.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
      hit.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
      hit.click();
      await sleep(200);
      return verifyCommitted(input, value, true);
    }
  }
  return false;
}

async function driveCombobox(fieldId: string, value: string): Promise<boolean> {
  const el = document.querySelector<HTMLElement>(`[data-offeros-id="${CSS.escape(fieldId)}"]`);
  if (!(el instanceof HTMLInputElement)) return false;
  if (fiberSelect(el, value)) {
    await sleep(150);
    return verifyCommitted(el, value, false);
  }
  return domFallback(el, value);
}

// Resolve the widget container to fill skills into. The scanned element may be
// the input itself or the shadow host; fillSkills pierces shadow DOM from here.
function skillsHost(fieldId: string): Element | null {
  const el = document.querySelector<HTMLElement>(`[data-offeros-id="${CSS.escape(fieldId)}"]`);
  if (!el) return null;
  // A section/widget wrapper renders the suggestion list as a sibling of the
  // input, so climb one level when the scanned node is the bare input.
  return el instanceof HTMLInputElement ? (el.parentElement ?? el) : el;
}

export default defineContentScript({
  matches: [
    "*://*.greenhouse.io/*",
    "*://boards.greenhouse.io/*",
    "*://job-boards.greenhouse.io/*",
    "*://jobs.lever.co/*",
    "*://jobs.eu.lever.co/*",
    "*://*.ashbyhq.com/*",
    "*://*.myworkdayjobs.com/*",
  ],
  world: "MAIN",
  main() {
    window.addEventListener("message", (ev: MessageEvent) => {
      const d: unknown = ev.data;
      if (isComboboxFillMsg(d)) {
        void driveCombobox(d.fieldId, d.value).then((ok) => {
          window.postMessage({ kind: COMBOBOX_RESULT, fieldId: d.fieldId, ok }, "*");
        });
        return;
      }
      if (isSkillsFillMsg(d)) {
        const host = skillsHost(d.fieldId);
        const run = host
          ? fillSkills(host, d.values)
          : Promise.resolve({ filled: [] as string[], skipped: d.values });
        void run.then((res) => {
          window.postMessage(
            { kind: SKILLS_RESULT, fieldId: d.fieldId, filled: res.filled.length, skipped: res.skipped.length },
            "*",
          );
        });
        return;
      }
    });
  },
});
