// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { expandRepeater, findRepeaters } from "../../src/lib/autofill/repeater";

/**
 * Sections with no fields until you ask for them.
 *
 * Education and work history are often an empty table with an Add button: the
 * row does not exist in the DOM until a click creates it. A scan of such a page
 * finds the button and nothing else — so the panel reports a form with no
 * education fields, nothing looks wrong, and the application goes in with an
 * empty history.
 *
 * The fixture imitates the accessible name a real form used, including the
 * count it states about itself.
 */

beforeEach(() => {
  document.body.innerHTML = "";
});

/** A section that renders a row per click, up to `max`. */
function mountRepeater(opts: { max?: number; obedient?: boolean; label?: string } = {}) {
  const max = opts.max ?? 10;
  const label =
    opts.label ??
    `Add an entry to the Educational Details tabular section. 0 of ${max} entries added currently.`;
  document.body.innerHTML = `<main><form>
    <div role="region" aria-label="Educational Details">
      <div id="rows"></div>
      <button type="button" id="add" aria-label="${label}">+ Add</button>
    </div>
  </form></main>`;
  const rows = document.getElementById("rows")!;
  document.getElementById("add")!.addEventListener("click", () => {
    if (opts.obedient === false) return;
    if (rows.querySelectorAll("input").length / 2 >= max) return;
    const row = document.createElement("div");
    row.innerHTML = `<input name="school" /><input name="degree" />`;
    rows.appendChild(row);
  });
}

describe("finding the sections that expand", () => {
  it("recognises an add control by what a screen reader would announce", () => {
    mountRepeater();
    const found = findRepeaters(document);
    expect(found).toHaveLength(1);
    expect(found[0]!.name).toBe("Educational Details");
  });

  it("believes the page's own statement of how many rows it allows", () => {
    mountRepeater({ max: 3 });
    expect(findRepeaters(document)[0]!.max).toBe(3);
  });

  it.each(["+ Add", "Add another", "Add an entry", "Add more rows", "ADD ANOTHER EMPLOYER"])(
    "recognises %o",
    (text) => {
      document.body.innerHTML = `<main><form><section><button type="button">${text}</button></section></form></main>`;
      expect(findRepeaters(document)).toHaveLength(1);
    },
  );

  it.each(["Submit Application", "Address", "Add-ons included", "Upload"])(
    "does not mistake %o for one",
    (text) => {
      document.body.innerHTML = `<main><form><section><button type="button">${text}</button></section></form></main>`;
      expect(findRepeaters(document)).toHaveLength(0);
    },
  );

  it.each(["Add to favorites", "☆ Add to saved jobs", "Add to calendar", "Add to cart"])(
    "%o is page furniture, not a row-adder — even inside the form",
    (text) => {
      document.body.innerHTML = `<main><form><section><button type="button">${text}</button></section></form></main>`;
      expect(findRepeaters(document)).toHaveLength(0);
    },
  );

  it('"Add an entry to the Education section" survives the add-to guard', () => {
    document.body.innerHTML = `<main><form><section><button type="button" aria-label="Add an entry to the Education section. 0 of 10 entries added currently.">Add</button></section></form></main>`;
    expect(findRepeaters(document)).toHaveLength(1);
  });

  it("a row-adder outside any form is never clicked material", () => {
    // Same wording, no form around it — a repeater only lives in a form.
    document.body.innerHTML = `<main><section><button type="button">+ Add</button></section></main>`;
    expect(findRepeaters(document)).toHaveLength(0);
  });

  it("reports one section per region, not one per button", () => {
    mountRepeater();
    const region = document.querySelector('[role="region"]')!;
    const second = document.createElement("button");
    second.textContent = "Add another";
    region.appendChild(second);
    expect(findRepeaters(document)).toHaveLength(1);
  });
});

describe("opening them", () => {
  it("adds a row per entry the caller has to place", async () => {
    mountRepeater();
    const out = await expandRepeater(findRepeaters(document)[0]!, 3);
    expect(out.added).toBe(3);
    expect(out.reason).toBeUndefined();
    expect(document.querySelectorAll("#rows input")).toHaveLength(6);
  });

  it("stops at the page's stated maximum rather than clicking on", async () => {
    mountRepeater({ max: 2 });
    const out = await expandRepeater(findRepeaters(document)[0]!, 5);
    expect(out.added).toBe(2);
  });

  it("says so when the button does nothing, instead of assuming it worked", async () => {
    // A button that does nothing looks exactly like one that worked, until
    // you count.
    mountRepeater({ obedient: false });
    const out = await expandRepeater(findRepeaters(document)[0]!, 2);
    expect(out.added).toBe(0);
    expect(out.reason).toMatch(/did not produce a row/);
  });

  it("stops the moment a click stops producing rows", async () => {
    // Asking again after the page has refused is how a loop becomes a hundred
    // clicks on somebody's form.
    mountRepeater({ max: 1 });
    const section = findRepeaters(document)[0]!;
    section.max = undefined; // page understated its limit
    const out = await expandRepeater(section, 4);
    expect(out.added).toBe(1);
    expect(out.reason).toMatch(/stopped adding rows/);
  });

  it("asks for nothing when the page is already full", async () => {
    mountRepeater({ max: 2 });
    const section = findRepeaters(document)[0]!;
    section.current = 2;
    const out = await expandRepeater(section, 3);
    expect(out.added).toBe(0);
    expect(out.reason).toMatch(/no more entries/);
  });
});
