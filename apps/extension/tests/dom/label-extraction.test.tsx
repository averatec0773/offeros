// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { scanFields } from "../../src/lib/autofill/dom-fill";
import { GENERIC_RECIPE } from "../../src/lib/autofill/recipes";

/**
 * Reading a form that never associated a single label with a single field.
 *
 * These fixtures reproduce, in synthetic form, what a survey of a real hosted
 * application form turned up. Everything the page did wrong there is here:
 *
 *   - a `<label>` sits in the same row as its input, with no `for`, no
 *     wrapping, and no aria — the association is layout and nothing else;
 *   - the label DOES carry an id, built from the input's id by a fixed
 *     convention (`<prefix>label-<inputId>`), which is an association if you
 *     know to look for it;
 *   - every field appears twice, once live and once as a hidden template, both
 *     under the same id — so `getElementById` returns the one with no label;
 *   - dropdowns contribute `-None-`, `Loading` and `No Results Found` as though
 *     those were questions;
 *   - a phone widget contributes its country-code search box as a field.
 *
 * The panel showed the user `rec-form_682152000000063542` and `-None-`, and the
 * AI fallback classifier — handed exactly that — honestly placed zero. It was
 * not wrong; it was told nothing. The field ids below imitate that shape
 * because the shape is the point.
 */

beforeEach(() => {
  document.body.innerHTML = "";
});

const scan = () => scanFields(document.body, GENERIC_RECIPE).map((f) => f.descriptor);
const labels = () => scan().map((d) => d.label);

describe("a label associated only by being in the same row", () => {
  it("finds it, instead of falling back to the field's own id", () => {
    document.body.innerHTML = `<main><form>
      <div class="crm-row">
        <label class="crm-from-label">First Name *</label>
        <input id="rec-form_682152000000063542" name="rec-form_682152000000063542" />
      </div>
    </form></main>`;
    expect(labels()).toEqual(["First Name *"]);
  });

  it("carries the required marker the label's asterisk implies", () => {
    document.body.innerHTML = `<main><form>
      <div class="crm-row">
        <label class="crm-from-label">Email *</label>
        <input id="rec-form_682152000000063550" />
      </div>
    </form></main>`;
    expect(scan()[0]!.required).toBe(true);
  });

  it("reads each row's own label when several rows sit side by side", () => {
    // The failure this guards against is one label spreading across a section:
    // every field in the block named after the block.
    document.body.innerHTML = `<main><form>
      <div class="crm-row">
        <label class="crm-from-label">First Name *</label>
        <input id="rec-form_1" />
      </div>
      <div class="crm-row">
        <label class="crm-from-label">Last Name *</label>
        <input id="rec-form_2" />
      </div>
      <div class="crm-row">
        <label class="crm-from-label">Email *</label>
        <input id="rec-form_3" />
      </div>
    </form></main>`;
    expect(labels()).toEqual(["First Name *", "Last Name *", "Email *"]);
  });
});

describe("a label bound by an id convention", () => {
  it("finds a label whose id is a prefix plus the field's id", () => {
    // No `for`, no wrapping — but the label's id is derived from the input's,
    // deterministically. Recognising the SHAPE is what makes this general;
    // hard-coding one framework's prefix would not be.
    document.body.innerHTML = `<main><form>
      <label id="crc-label-rec-form_682152000000063542">Last Name</label>
      <div><input id="rec-form_682152000000063542" /></div>
    </form></main>`;
    expect(labels()).toEqual(["Last Name"]);
  });

  it("finds one whose id is the field's id plus a suffix", () => {
    document.body.innerHTML = `<main><form>
      <label id="rec-form_9001-label">Phone Number</label>
      <div><input id="rec-form_9001" /></div>
    </form></main>`;
    expect(labels()).toEqual(["Phone Number"]);
  });

  it("prefers the id-bound label over whatever text happens to sit above", () => {
    // The heuristic that reads the nearest preceding text is the last rung for
    // a reason: here it would answer "Section 2", and the page has said
    // something far more precise than that.
    document.body.innerHTML = `<main><form>
      <h3>Section 2</h3>
      <label id="crc-label-rec-form_2222">Portfolio URL</label>
      <div><input id="rec-form_2222" /></div>
    </form></main>`;
    expect(labels()).toEqual(["Portfolio URL"]);
  });
});

describe("the hidden twin", () => {
  it("scans one field per id, and reads the visible one's label", () => {
    // Both copies carry the same id; only the live one has a label beside it.
    // Document order puts the template first, which is exactly why picking
    // "the first element with this id" produced a nameless field.
    document.body.innerHTML = `<main>
      <div id="template" style="display:none">
        <div class="crm-row"><input id="rec-form_777" /></div>
      </div>
      <form>
        <div class="crm-row">
          <label class="crm-from-label">Current Company</label>
          <input id="rec-form_777" />
        </div>
      </form>
    </main>`;
    const found = scan();
    expect(found).toHaveLength(1);
    expect(found[0]!.label).toBe("Current Company");
  });
});

describe("what is not a question", () => {
  it("never surfaces a raw field id as a label", () => {
    document.body.innerHTML = `<main><form>
      <input id="rec-form_682152000000063542" name="rec-form_682152000000063542" />
    </form></main>`;
    // With nothing to read it stays honestly nameless — which is what sends it
    // to the classifier with its surroundings, rather than sending an id.
    expect(labels()).toEqual([""]);
  });

  it("never surfaces a dropdown's empty placeholder as a label", () => {
    document.body.innerHTML = `<main><form>
      <div class="crm-row">
        <select id="rec-form_3001">
          <option>-None-</option>
          <option>Yes</option>
        </select>
      </div>
    </form></main>`;
    expect(labels()).toEqual([""]);
  });

  it("never surfaces a loading state as a label", () => {
    document.body.innerHTML = `<main><form>
      <div class="crm-row">
        <label class="crm-from-label">Loading</label>
        <input id="rec-form_4001" />
      </div>
    </form></main>`;
    expect(labels()).toEqual([""]);
  });
});
