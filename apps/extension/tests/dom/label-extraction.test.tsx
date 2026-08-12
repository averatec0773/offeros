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

/**
 * The second survey of the same form, after the first fix did not take.
 *
 * The ladder shipped, and on the real page it still produced nothing. Three
 * DOM facts explained why, and every one of them is a shape other component
 * frameworks share:
 *
 *   F1. the visible `<input>` has an EMPTY id. The identity is in `name`; the
 *       id belongs to the wrapper that rendered it, and to a hidden template
 *       twin carrying a full copy of the field.
 *   F2. the conventions all key off that name — `crc-label-<name>` on the
 *       label, `crc-<name>` in the row container's class — and the wrapper
 *       carries the human name outright in a component property.
 *   F3. the row container sits one level further up than the walk allowed.
 *
 * The ids and names below imitate the real shapes; the labels are synthetic.
 */
describe("a component framework that puts identity in name, not id", () => {
  it("finds a convention label keyed on the field's name", () => {
    // F1 + F2: id="" on the input, so every id-keyed rung had nothing to key on.
    document.body.innerHTML = `<main><form>
      <label id="crc-label-rec-form_682152000000063542">Current Employer</label>
      <div class="crc-rec-form_682152000000063542">
        <input id="" name="rec-form_682152000000063542" />
      </div>
    </form></main>`;
    expect(labels()).toEqual(["Current Employer"]);
  });

  it("finds a row container whose class carries the field's name", () => {
    document.body.innerHTML = `<main><form>
      <div class="crc-rec-form_682152000000063550 row">
        <label class="crm-from-label">Notice Period *</label>
        <input id="" name="rec-form_682152000000063550" />
      </div>
    </form></main>`;
    expect(labels()).toEqual(["Notice Period *"]);
  });

  it("reads a label the wrapper carries as a component property", () => {
    // The name is right there in an attribute, and no <label> element exists.
    document.body.innerHTML = `<main><form>
      <div cx-prop-label="Highest Qualification">
        <div class="wrapper"><input id="" name="rec-form_9100" /></div>
      </div>
    </form></main>`;
    expect(labels()).toEqual(["Highest Qualification"]);
  });

  it("accepts any framework's spelling of that attribute", () => {
    // The pattern is "attribute whose NAME contains label" — the spelling is
    // the only part that differs between frameworks.
    for (const attr of ["data-label", "lt-prop-label", "ui-label"]) {
      document.body.innerHTML = `<main><form>
        <div ${attr}="Portfolio Link"><input id="" name="rec-form_9200" /></div>
      </form></main>`;
      expect(labels(), attr).toEqual(["Portfolio Link"]);
    }
  });

  it("refuses an attribute value that is not something a person would read", () => {
    // Component props hold ids, booleans and template expressions as often as
    // they hold names.
    for (const value of ["{{field.label}}", "rec-form_9300", "true", "12345", "<b>x</b>"]) {
      document.body.innerHTML = `<main><form>
        <div cx-prop-label="${value}"><input id="" name="rec-form_9300" /></div>
      </form></main>`;
      expect(labels(), value).toEqual([""]);
    }
  });

  it("reaches a row container one level deeper than the old budget allowed", () => {
    // F3: the real page nested the input this far below its row.
    document.body.innerHTML = `<main><form>
      <div class="crc-rec-form_682152000000063999 row">
        <label class="crm-from-label">Reason for leaving</label>
        <div><div><div><div><div><input id="" name="rec-form_682152000000063999" /></div></div></div></div></div>
      </div>
    </form></main>`;
    expect(labels()).toEqual(["Reason for leaving"]);
  });
});

describe("the framework's hidden template twin", () => {
  it("is not scanned, so the field is listed once and reads its real label", () => {
    // Both copies carry the same name; the template comes first in document
    // order, which is why the visible one's label kept going unread.
    document.body.innerHTML = `<main><form>
      <template is="component">
        <div class="crc-rec-form_777"><input id="" name="rec-form_777" /></div>
      </template>
      <div class="crc-rec-form_777 row">
        <label class="crm-from-label">Expected Salary</label>
        <input id="" name="rec-form_777" />
      </div>
    </form></main>`;
    const found = scan();
    expect(found).toHaveLength(1);
    expect(found[0]!.label).toBe("Expected Salary");
  });

  it("ignores a component twin that is not a <template> element", () => {
    document.body.innerHTML = `<main><form>
      <div is="component"><input id="" name="rec-form_888" /></div>
      <div class="crc-rec-form_888 row">
        <label class="crm-from-label">Availability</label>
        <input id="" name="rec-form_888" />
      </div>
    </form></main>`;
    const found = scan();
    expect(found).toHaveLength(1);
    expect(found[0]!.label).toBe("Availability");
  });
});
