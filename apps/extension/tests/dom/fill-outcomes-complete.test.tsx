// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { applyFillDetailed, scanFields } from "../../src/lib/autofill/dom-fill";
import { GENERIC_RECIPE } from "../../src/lib/autofill/recipes";
import { buildFieldReports, type WriteOutcome } from "../../src/lib/autofill/task-mode";
import type { FieldTrace } from "@offeros/autofill";

/**
 * Every field we try to fill has to come back and say what happened to it.
 *
 * A real application went out with three Equal Employment dropdowns and a phone
 * number empty. All four had matched — the plan said `fillable` and held the
 * right value — and all four came back `skipped`. That word is the report's
 * term for a control we deliberately left alone: `handoverList` only surfaces a
 * skipped field if it is `unknown` AND required, `diagnose` does not count one
 * as a problem, and the requirements check filters it out. So a `fillable`
 * field that lands there is invisible in every direction at once — not filled,
 * not failed, not handed back, not counted.
 *
 * `skipped` is produced by absence: `buildFieldReports` writes it for any field
 * with no entry in the writes map. So the rule these tests hold is that a field
 * sent to the page always produces an entry, whatever went wrong — and the
 * three legal endings for a fillable field are filled, an explicit failure, or
 * an explicit hand-back. Never silence.
 */

beforeEach(() => {
  document.body.innerHTML = "";
});

const stamped = (html: string) => {
  document.body.innerHTML = `<main><form>${html}</form></main>`;
  return scanFields(document.body, GENERIC_RECIPE)[0]!.descriptor;
};

describe("a field that was sent always reports back", () => {
  it("says the field is gone when the page re-rendered it away", async () => {
    const d = stamped(`<label for="mob">Mobile</label><input id="mob" type="tel" />`);
    // The page rebuilds the control between the scan and the fill — a React
    // re-render triggered by the writes just before it. The scan's handle is
    // stamped on the old node, which no longer exists.
    document
      .getElementById("mob")!
      .replaceWith(Object.assign(document.createElement("input"), { id: "mob", type: "tel" }));

    const { filled, outcomes } = await applyFillDetailed(document, [
      { fieldId: d.fieldId, value: "555-0100" },
    ]);
    expect(filled).toBe(0);
    const outcome = outcomes.get(d.fieldId);
    expect(outcome, "a field that vanished must not vanish from the report too").toBeDefined();
    expect((outcome as { outcome: string }).outcome).toBe("failed");
    expect((outcome as { reason: string }).reason).toMatch(/no longer on the page/i);
  });

  it("says so when the control is not one it knows how to operate", async () => {
    document.body.innerHTML = `<main><form>
      <span id="q">Veteran Status</span>
      <div id="w" data-offeros-id="custom-1" aria-labelledby="q">Select…</div>
    </form></main>`;

    const { outcomes } = await applyFillDetailed(document, [
      { fieldId: "custom-1", value: "I am not a protected veteran" },
    ]);
    const outcome = outcomes.get("custom-1");
    expect(outcome).toBeDefined();
    expect((outcome as { outcome: string }).outcome).toBe("failed");
    expect((outcome as { reason: string }).reason).toMatch(/set it yourself/i);
  });

  it("still leaves a file input out — that one is the attach path's to report", async () => {
    const d = stamped(`<label for="cv">Resume</label><input id="cv" type="file" />`);
    const { outcomes } = await applyFillDetailed(document, [
      { fieldId: d.fieldId, value: "resume.pdf" },
    ]);
    // Absence is correct here and only here: the caller reports a file field
    // from the plan, because the bytes are attached by a different path.
    expect(outcomes.has(d.fieldId)).toBe(false);
  });

  it("a dropdown that will not open and cannot be typed into fails out loud", async () => {
    document.body.innerHTML = `<main><form>
      <span id="q">Veteran Status</span>
      <div id="cb" role="combobox" aria-labelledby="q" aria-expanded="false">Select one</div>
    </form></main>`;
    const d = scanFields(document.body, GENERIC_RECIPE)[0]!.descriptor;
    const { outcomes } = await applyFillDetailed(document, [
      { fieldId: d.fieldId, value: "I am not a protected veteran" },
    ]);
    const outcome = outcomes.get(d.fieldId) as { outcome: string; reason: string };
    expect(outcome.outcome).toBe("failed");
    expect(outcome.reason).toMatch(/didn't open/i);
  });
});

/**
 * The report vocabulary, held at the seam where it is produced.
 *
 * This is the assertion the four lost fields would have tripped.
 */
describe("the report never files a fillable field under skipped", () => {
  const trace = (over: Partial<FieldTrace>): FieldTrace =>
    ({
      fieldId: "f1",
      label: "Veteran Status",
      classifiedType: "unknown",
      status: "fillable",
      chosenValue: "I am not a protected veteran",
      source: "answer-bank",
      reason: "answer-bank pattern matched",
      ...over,
    }) as FieldTrace;

  it("an unwritten fillable field is a hand-back, not a silence", () => {
    const reports = buildFieldReports([trace({})], new Map<string, WriteOutcome>(), new Set(), "p");
    expect(reports[0]!.outcome).not.toBe("skipped");
    expect(reports[0]!.outcome).toBe("needs-user");
  });

  it("leaves unknown fields alone — skipped still means we correctly did nothing", () => {
    const reports = buildFieldReports(
      [trace({ status: "unknown", chosenValue: "" })],
      new Map<string, WriteOutcome>(),
      new Set(),
      "p",
    );
    expect(reports[0]!.outcome).toBe("skipped");
  });
});

/**
 * Why those dropdowns never opened.
 *
 * The option-clicking code in this file already knows that "widgets that listen
 * on mousedown rather than click are common enough that a bare click misses
 * them" — and then the code that OPENS the popup used a bare click. A widget
 * that opens on mousedown, or on a keypress, was unreachable however many
 * times we asked.
 *
 * These fixtures are synthetic: each opens on exactly one gesture, so a failure
 * names which gesture is missing rather than just saying the dropdown is shut.
 */
describe("opening a dropdown that ignores a plain click", () => {
  const mountOpeningOn = (event: "mousedown" | "keydown" | "pointerdown") => {
    document.body.innerHTML = `<main><form>
      <span id="q">Veteran Status</span>
      <div id="cb" role="combobox" aria-labelledby="q" aria-expanded="false" tabindex="0">Select one</div>
    </form></main>`;
    const cb = document.getElementById("cb") as HTMLElement;
    const open = () => {
      if (document.getElementById("lb")) return;
      const lb = document.createElement("div");
      lb.id = "lb";
      lb.setAttribute("role", "listbox");
      lb.innerHTML = ["I am not a protected veteran", "I don't wish to answer"]
        .map((o, i) => `<div role="option" id="o${i}" aria-selected="false">${o}</div>`)
        .join("");
      document.body.appendChild(lb);
      cb.setAttribute("aria-expanded", "true");
      for (const o of Array.from(lb.querySelectorAll('[role="option"]'))) {
        o.addEventListener("click", () => {
          o.setAttribute("aria-selected", "true");
          cb.textContent = o.textContent;
          lb.remove();
        });
      }
    };
    cb.addEventListener(event, open);
    return scanFields(document.body, GENERIC_RECIPE)[0]!.descriptor;
  };

  for (const event of ["mousedown", "pointerdown", "keydown"] as const) {
    it(`opens a widget that listens on ${event}`, async () => {
      const d = mountOpeningOn(event);
      const { filled, outcomes } = await applyFillDetailed(document, [
        { fieldId: d.fieldId, value: "I am not a protected veteran" },
      ]);
      expect(outcomes.get(d.fieldId), `${event}: outcome missing`).toBeDefined();
      expect(filled, `${event}: never opened`).toBe(1);
    });
  }
});

/**
 * The two halves of the real form, in one round.
 *
 * The address fields were text boxes wearing a combobox role and the typed
 * fallback filled them; the Equal Employment dropdowns were neither openable
 * nor typeable. Both happened on the same page in the same pass, and the pass
 * has to be honest about each of them separately — the failure of one is not
 * allowed to become the silence of the other.
 */
describe("a typed fallback and an unreachable dropdown, in the same round", () => {
  it("fills the one, fails the other out loud, and reports both", async () => {
    document.body.innerHTML = `<main><form>
      <label for="zip">Zip/Postal Code</label>
      <div id="zipwrap" role="combobox" aria-haspopup="listbox"><input id="zip" type="text" /></div>
      <span id="vq">Veteran Status</span>
      <div id="vet" role="combobox" aria-labelledby="vq" aria-expanded="false">Select one</div>
    </form></main>`;
    const scanned = scanFields(document.body, GENERIC_RECIPE);
    const zip = scanned.find((f) => f.descriptor.label === "Zip/Postal Code")!.descriptor;
    const vet = scanned.find((f) => f.descriptor.label === "Veteran Status")!.descriptor;

    const { filled, outcomes } = await applyFillDetailed(document, [
      { fieldId: zip.fieldId, value: "77041" },
      { fieldId: vet.fieldId, value: "I am not a protected veteran" },
    ]);

    expect(filled).toBe(1);
    expect((document.getElementById("zip") as HTMLInputElement).value).toBe("77041");
    const zipOutcome = outcomes.get(zip.fieldId) as { outcome: string; reason: string };
    expect(zipOutcome.outcome).toBe("filled");
    expect(zipOutcome.reason).toMatch(/typed in as text/i);

    const vetOutcome = outcomes.get(vet.fieldId) as { outcome: string; reason: string };
    expect(vetOutcome, "the unreachable one must still be in the report").toBeDefined();
    expect(vetOutcome.outcome).toBe("failed");
    expect(vetOutcome.reason).toMatch(/didn't open/i);
  });
});
