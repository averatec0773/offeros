// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyFillDetailed, scanFields } from "../../src/lib/autofill/dom-fill";
import { matchAts } from "../../src/lib/autofill/recipes";
import { pageSignature } from "../../src/lib/engine/page-watcher";

// Fixture shapes verified live on a wd1.myworkdayjobs.com tenant (2026-08-10):
// each dropdown is a div[data-automation-id="formField-…"] holding a
// <label for> that points at a <button aria-haspopup="listbox"> whose text is
// the current value ("Select One" when unset) and whose aria-label bakes in
// question + current value + "Required". Synthetic questions/values only.

const workday = matchAts("https://acme.wd1.myworkdayjobs.com/en-US/careers/job/x/apply")!;
const greenhouse = matchAts("https://boards.greenhouse.io/acme/jobs/1")!;

function dropdownField(id: string, question: string, value = "Select One"): string {
  return `
    <div data-automation-id="formField-${id}">
      <label for="${id}--${id}"><span>${question}<abbr>*</abbr></span></label>
      <div><div><div>
        <button aria-haspopup="listbox" aria-expanded="false" type="button"
          aria-label="${question} ${value} Required" name="${id}"
          id="${id}--${id}">${value}</button>
        <input type="text" />
      </div></div></div>
    </div>`;
}

// The Application Questions wizard page: four required dropdowns, nothing else.
const QUESTIONS_PAGE = `
  <div data-automation-id="applyFlowPage">
    <div data-automation-id="primaryQuestionnairePage">
      ${dropdownField("q18", "Are you 18 years of age or older?")}
      ${dropdownField("qAuth", "Are you legally authorized to work in the United States?")}
      ${dropdownField("qVisa", "Will you require sponsorship for employment visa status?")}
      ${dropdownField("qPrev", "Have you previously worked for Acme?")}
    </div>
  </div>`;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("scanFields — Workday listbox-button dropdowns (W5)", () => {
  it("finds the four Application Questions dropdowns with their labels", () => {
    document.body.innerHTML = QUESTIONS_PAGE;
    const found = scanFields(document.body, workday);
    expect(found).toHaveLength(4);
    const labels = found.map((f) => f.descriptor.label);
    expect(labels).toEqual([
      "Are you 18 years of age or older?*",
      "Are you legally authorized to work in the United States?*",
      "Will you require sponsorship for employment visa status?*",
      "Have you previously worked for Acme?*",
    ]);
    for (const f of found) {
      expect(f.descriptor.type).toBe("listbox");
      expect(f.descriptor.required).toBe(true);
      // "Select One" is Workday's unselected placeholder, not a value.
      expect(f.descriptor.currentValue).toBe("");
      // The button's aria-label bakes in the CURRENT value ("… LinkedIn
      // Required") — it must not ride the descriptor or the classifier
      // reads the value as a signal.
      expect(f.descriptor.ariaLabel).toBe("");
    }
  });

  it("reports a selected dropdown's rendered text as its current value", () => {
    document.body.innerHTML = dropdownField("q18", "Are you 18 years of age or older?", "Yes");
    const found = scanFields(document.body, workday);
    expect(found).toHaveLength(1);
    expect(found[0]!.descriptor.currentValue).toBe("Yes");
  });

  it("does not widen other ATSs: greenhouse scan ignores listbox buttons", () => {
    document.body.innerHTML = QUESTIONS_PAGE;
    const found = scanFields(document.body, greenhouse);
    expect(found).toHaveLength(0);
  });
});

describe("applyFillDetailed — Workday listbox driver (W5 fill)", () => {
  /** Wire a fixture button to behave like the live widget: clicking toggles a
   *  body-level portal ul[role=listbox]; clicking an option sets the button's
   *  text and removes the portal. */
  function wireWidget(button: HTMLButtonElement, options: string[]): void {
    let portal: HTMLElement | null = null;
    button.addEventListener("click", () => {
      if (portal) {
        portal.remove();
        portal = null;
        return;
      }
      portal = document.createElement("div");
      const ul = document.createElement("ul");
      ul.setAttribute("role", "listbox");
      for (const opt of options) {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.textContent = opt;
        li.addEventListener("click", () => {
          button.textContent = opt;
          portal?.remove();
          portal = null;
        });
        ul.appendChild(li);
      }
      portal.appendChild(ul);
      document.body.appendChild(portal);
    });
  }

  it("clicks through the popup and verifies the button's rendered text", async () => {
    document.body.innerHTML = `
      ${dropdownField("q18", "Are you 18 years of age or older?")}
      <!-- permanent pill listbox (phone-code multiselect) that must NOT be
           mistaken for the popup -->
      <ul role="listbox" data-automation-id="selectedItemList"></ul>`;
    const button = document.querySelector<HTMLButtonElement>("button[aria-haspopup]")!;
    wireWidget(button, ["Select One", "Yes", "No"]);
    const [scanned] = scanFields(document.body, workday);
    const { filled, outcomes } = await applyFillDetailed(document, [
      { fieldId: scanned!.descriptor.fieldId, value: "Yes" },
    ]);
    expect(filled).toBe(1);
    expect(outcomes.get(scanned!.descriptor.fieldId)).toBe("filled");
    expect(button.textContent).toBe("Yes");
  });

  it("reports failed and closes the popup when no option matches", async () => {
    document.body.innerHTML = dropdownField("q18", "Are you 18 years of age or older?");
    const button = document.querySelector<HTMLButtonElement>("button[aria-haspopup]")!;
    wireWidget(button, ["Select One", "Yes", "No"]);
    const [scanned] = scanFields(document.body, workday);
    const { filled, outcomes } = await applyFillDetailed(document, [
      { fieldId: scanned!.descriptor.fieldId, value: "555-0100" },
    ]);
    expect(filled).toBe(0);
    expect(outcomes.get(scanned!.descriptor.fieldId)).toBe("failed");
    expect(button.textContent).toBe("Select One"); // value untouched
    // popup toggled closed — no stray portal listbox left behind
    expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(0);
  });

  it("leaves an already-matching selection alone without reopening", async () => {
    document.body.innerHTML = dropdownField("q18", "Are you 18 years of age or older?", "Yes");
    const button = document.querySelector<HTMLButtonElement>("button[aria-haspopup]")!;
    const clicks = vi.fn();
    button.addEventListener("click", clicks);
    const [scanned] = scanFields(document.body, workday);
    const { filled } = await applyFillDetailed(document, [
      { fieldId: scanned!.descriptor.fieldId, value: "Yes" },
    ]);
    expect(filled).toBe(1);
    expect(clicks).not.toHaveBeenCalled();
  });
});

describe("pageSignature — rescan signal on gained widgets (W2)", () => {
  it("changes when a listbox-button dropdown materializes", () => {
    document.body.innerHTML = `<div id="section"><button type="button">Add</button></div>`;
    const before = pageSignature(document);
    document
      .getElementById("section")!
      .insertAdjacentHTML("beforeend", dropdownField("q1", "Degree"));
    expect(pageSignature(document)).not.toBe(before);
  });

  it("sees fields inside open shadow roots only when piercing", () => {
    class WdSection extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: "open" });
      }
    }
    if (!customElements.get("wd-section")) customElements.define("wd-section", WdSection);
    document.body.innerHTML = "<wd-section></wd-section>";
    const host = document.querySelector("wd-section")!;
    const flat = pageSignature(document);
    const deep = pageSignature(document, { pierce: true });
    host.shadowRoot!.innerHTML = '<input type="text" name="website" aria-label="Website" />';
    // light-DOM signature is blind to the gained field — the historical W2 hole
    expect(pageSignature(document)).toBe(flat);
    // the piercing signature (what the Workday watcher now uses) sees it
    expect(pageSignature(document, { pierce: true })).not.toBe(deep);
  });
});
