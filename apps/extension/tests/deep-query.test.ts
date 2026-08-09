// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { deepQuery, deepQueryAll } from "../src/lib/autofill/deep-query";

// Build a Workday-style widget: a custom element whose real <input> lives in a
// shadow root, with suggestion items that each keep their clickable text in
// their OWN shadow root (two levels of shadow).
class Host extends HTMLElement {
  constructor() {
    super();
    const r = this.attachShadow({ mode: "open" });
    r.innerHTML = '<input type="text" />';
  }
}
class Item extends HTMLElement {
  constructor() {
    super();
    const r = this.attachShadow({ mode: "open" });
    r.innerHTML = '<span role="option"></span>';
  }
}
if (!customElements.get("dq-host")) customElements.define("dq-host", Host);
if (!customElements.get("dq-item")) customElements.define("dq-item", Item);

describe("deepQuery — pierces shadow roots", () => {
  beforeEach(() => {
    document.body.innerHTML =
      "<h2>Skills</h2><dq-host></dq-host><dq-item></dq-item><dq-item></dq-item>";
  });

  it("finds an element inside a shadow root that a light-DOM query misses", () => {
    expect(document.querySelector("input")).toBeNull(); // light DOM has no input
    const found = deepQuery(document, "input");
    expect(found).not.toBeNull();
    expect(found!.tagName.toLowerCase()).toBe("input");
  });

  it("finds elements nested two shadow levels deep", () => {
    const opt = deepQuery(document, '[role="option"]');
    expect(opt).not.toBeNull();
    expect(opt!.getAttribute("role")).toBe("option");
  });

  it("deepQueryAll collects matches across every shadow root", () => {
    const opts = deepQueryAll(document, '[role="option"]');
    expect(opts.length).toBe(2);
  });

  it("still finds light-DOM matches", () => {
    const h2 = deepQuery(document, "h2");
    expect(h2!.textContent).toBe("Skills");
  });

  it("returns null / empty when nothing matches", () => {
    expect(deepQuery(document, "textarea")).toBeNull();
    expect(deepQueryAll(document, "textarea")).toEqual([]);
  });
});
