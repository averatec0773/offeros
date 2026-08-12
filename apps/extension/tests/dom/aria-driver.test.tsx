// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { applyFillDetailed, scanFields } from "../../src/lib/autofill/dom-fill";
import { GENERIC_RECIPE } from "../../src/lib/autofill/recipes";
import { matchAts } from "../../src/lib/autofill/recipes";

/**
 * The generic ARIA driver: the layer that runs when no site-specific driver
 * recognises a control.
 *
 * Two things these tests exist to hold. A widget that publishes the standard
 * roles can be driven without anyone writing a driver for it — that is the
 * whole point. And a widget that publishes the roles but ignores the click is
 * reported as failed with a reason, because ARIA is a description, not a
 * promise, and a hopeful success here puts an empty required field on a real
 * application.
 */

beforeEach(() => {
  document.body.innerHTML = "";
});

/**
 * An ARIA combobox that behaves. `portal` puts its listbox at the end of
 * <body> instead of inside the control, which is what most real widgets do.
 */
function mountCombobox(opts: { portal: boolean; options?: string[]; obedient?: boolean }) {
  const options = opts.options ?? ["United States", "Canada", "Germany"];
  document.body.innerHTML = `<main><form>
    <span id="q">Country</span>
    <div id="cb" role="combobox" aria-labelledby="q" aria-expanded="false" aria-controls="lb"
         tabindex="0">Select one</div>
    ${opts.portal ? "" : '<div id="host"></div>'}
  </form></main>`;
  const cb = document.getElementById("cb") as HTMLElement;
  cb.addEventListener("click", () => {
    if (document.getElementById("lb")) return;
    const lb = document.createElement("div");
    lb.id = "lb";
    lb.setAttribute("role", "listbox");
    lb.innerHTML = options
      .map((o, i) => `<div role="option" id="o${i}" aria-selected="false">${o}</div>`)
      .join("");
    (opts.portal ? document.body : document.getElementById("host")!).appendChild(lb);
    cb.setAttribute("aria-expanded", "true");
    if (opts.obedient === false) return;
    for (const o of Array.from(lb.querySelectorAll('[role="option"]'))) {
      o.addEventListener("click", () => {
        o.setAttribute("aria-selected", "true");
        cb.textContent = o.textContent;
        cb.setAttribute("aria-expanded", "false");
        lb.remove();
      });
    }
  });
  return scanFields(document.body, GENERIC_RECIPE)[0]!.descriptor;
}

describe("an ARIA combobox nobody wrote a driver for", () => {
  it("is scanned, and reports itself as a listbox rather than a div", async () => {
    const d = mountCombobox({ portal: true });
    // "div" would read as free text to both the classifier and the panel.
    expect(d.type).toBe("listbox");
    expect(d.label).toBe("Country");
  });

  it("opens it, picks the option, and the page confirms", async () => {
    const d = mountCombobox({ portal: true });
    const { filled, outcomes } = await applyFillDetailed(document, [
      { fieldId: d.fieldId, value: "United States" },
    ]);
    expect(filled).toBe(1);
    expect(outcomes.get(d.fieldId)).toBe("filled");
    expect(document.getElementById("cb")!.textContent).toBe("United States");
  });

  it("works when the listbox is portalled to the end of the body", async () => {
    // The popup is not a descendant of the control, which is why the search
    // for it runs at document level.
    const d = mountCombobox({ portal: true });
    await applyFillDetailed(document, [{ fieldId: d.fieldId, value: "Canada" }]);
    expect(document.getElementById("cb")!.textContent).toBe("Canada");
  });

  it("works when the listbox is rendered in place", async () => {
    const d = mountCombobox({ portal: false });
    await applyFillDetailed(document, [{ fieldId: d.fieldId, value: "Germany" }]);
    expect(document.getElementById("cb")!.textContent).toBe("Germany");
  });

  it("matches the option through the shared matcher, not by exact text", async () => {
    const d = mountCombobox({ portal: true });
    // "USA" is not one of the option labels; the geo matcher maps it.
    await applyFillDetailed(document, [{ fieldId: d.fieldId, value: "USA" }]);
    expect(document.getElementById("cb")!.textContent).toBe("United States");
  });

  it("leaves a field that already holds the answer alone", async () => {
    const d = mountCombobox({ portal: true });
    const cb = document.getElementById("cb")!;
    cb.textContent = "Canada";
    let opened = 0;
    cb.addEventListener("click", () => opened++);
    const { outcomes } = await applyFillDetailed(document, [
      { fieldId: d.fieldId, value: "Canada" },
    ]);
    expect(outcomes.get(d.fieldId)).toBe("filled");
    expect(opened).toBe(0);
  });
});

describe("a widget that publishes the roles and then ignores you", () => {
  it("reports failed with a reason when the popup never opens", async () => {
    document.body.innerHTML = `<main><form>
      <span id="q">Country</span>
      <div id="cb" role="combobox" aria-labelledby="q" aria-expanded="false">Select one</div>
    </form></main>`;
    const d = scanFields(document.body, GENERIC_RECIPE)[0]!.descriptor;
    const { filled, outcomes } = await applyFillDetailed(document, [
      { fieldId: d.fieldId, value: "Canada" },
    ]);
    expect(filled).toBe(0);
    const outcome = outcomes.get(d.fieldId) as { outcome: string; reason: string };
    expect(outcome.outcome).toBe("failed");
    expect(outcome.reason).toMatch(/didn't open/i);
  });

  it("reports failed, naming what it did offer, when nothing matches", async () => {
    const d = mountCombobox({ portal: true, options: ["Yes", "No"] });
    const { outcomes } = await applyFillDetailed(document, [
      { fieldId: d.fieldId, value: "Antarctica" },
    ]);
    const outcome = outcomes.get(d.fieldId) as { outcome: string; reason: string };
    expect(outcome.outcome).toBe("failed");
    expect(outcome.reason).toContain("Yes, No");
  });

  it("reports failed when the click lands but the widget never records it", async () => {
    // The worst case, and the reason every path here verifies: all the right
    // roles, an open popup, a clickable option, and nothing happens.
    const d = mountCombobox({ portal: true, obedient: false });
    const { filled, outcomes } = await applyFillDetailed(document, [
      { fieldId: d.fieldId, value: "Canada" },
    ]);
    expect(filled).toBe(0);
    const outcome = outcomes.get(d.fieldId) as { outcome: string; reason: string };
    expect(outcome.outcome).toBe("failed");
    expect(outcome.reason).toMatch(/didn't take it/i);
  });
});

function mountRadioGroup(obedient = true) {
  document.body.innerHTML = `<main><form>
    <div id="g" role="radiogroup" aria-label="Are you willing to relocate?">
      <div role="radio" aria-checked="false" id="yes">Yes</div>
      <div role="radio" aria-checked="false" id="no">No</div>
    </div>
  </form></main>`;
  if (obedient) {
    for (const r of Array.from(document.querySelectorAll('[role="radio"]'))) {
      r.addEventListener("click", () => {
        for (const other of Array.from(document.querySelectorAll('[role="radio"]'))) {
          other.setAttribute("aria-checked", String(other === r));
        }
      });
    }
  }
  return scanFields(document.body, GENERIC_RECIPE)[0]!.descriptor;
}

describe("a role-based radio group", () => {
  it("is scanned as a choice group carrying its options", async () => {
    const d = mountRadioGroup();
    // Without the options the answer bank and the AI option-picker have
    // nothing to answer with.
    expect(d.type).toBe("radio-group");
    expect(d.options).toEqual(["Yes", "No"]);
    expect(d.label).toBe("Are you willing to relocate?");
  });

  it("clicks the matching option and confirms with aria-checked", async () => {
    const d = mountRadioGroup();
    const { filled, outcomes } = await applyFillDetailed(document, [
      { fieldId: d.fieldId, value: "Yes" },
    ]);
    expect(filled).toBe(1);
    expect(outcomes.get(d.fieldId)).toBe("filled");
    expect(document.getElementById("yes")!.getAttribute("aria-checked")).toBe("true");
  });

  it("reports failed when the group never records the click", async () => {
    const d = mountRadioGroup(false);
    const { filled, outcomes } = await applyFillDetailed(document, [
      { fieldId: d.fieldId, value: "Yes" },
    ]);
    expect(filled).toBe(0);
    expect((outcomes.get(d.fieldId) as { outcome: string }).outcome).toBe("failed");
  });

  it("reports failed when no choice matches", async () => {
    const d = mountRadioGroup();
    const { outcomes } = await applyFillDetailed(document, [
      { fieldId: d.fieldId, value: "Maybe next year" },
    ]);
    const outcome = outcomes.get(d.fieldId) as { outcome: string; reason: string };
    expect(outcome.outcome).toBe("failed");
    expect(outcome.reason).toContain("Yes, No");
  });
});

describe("the specialist drivers keep their place at the front", () => {
  it("a native select is still assigned, never clicked at", async () => {
    // A <select> carrying role="combobox" exists in the wild. Driving it as a
    // popup would be slower and less reliable than simply assigning it.
    document.body.innerHTML = `<main><form>
      <label for="c">Country</label>
      <select id="c" name="country" role="combobox">
        <option value="">Select…</option>
        <option value="US">United States</option>
      </select>
    </form></main>`;
    const d = scanFields(document.body, GENERIC_RECIPE)[0]!.descriptor;
    let clicks = 0;
    document.getElementById("c")!.addEventListener("click", () => clicks++);
    const { outcomes } = await applyFillDetailed(document, [
      { fieldId: d.fieldId, value: "United States" },
    ]);
    expect(outcomes.get(d.fieldId)).toBe("filled");
    expect((document.getElementById("c") as HTMLSelectElement).value).toBe("US");
    expect(clicks).toBe(0);
  });

  it("Workday's listbox button still takes the Workday path", async () => {
    // Its recipe is unchanged and it is matched by URL, so the generic layer
    // never sees it. This asserts the ordering has not been inverted.
    const workday = matchAts("https://acme.wd1.myworkdayjobs.com/en-US/careers/job/x")!;
    expect(workday.atsId).toBe("myworkday");
    expect(workday.fieldSelector).toContain('button[aria-haspopup="listbox"]');
  });
});
