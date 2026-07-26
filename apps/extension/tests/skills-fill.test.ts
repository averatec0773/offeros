// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { fillSkills } from "../src/lib/autofill/skills-fill";

// A faithful Workday-style skills widget: the real <input> lives in a shadow
// root; async suggestions render as items whose clickable <span role="option">
// text is in their OWN shadow root; committing a skill clears the input and adds
// a chip. Taxonomy is closed and omits "Floating-point arithmetic".
const TAXONOMY = ["C", "C++", "C#", "Linux", "CUDA", "Python", "Software Architecture"];

class SkillInput extends HTMLElement {
  _input!: HTMLInputElement;
  selected = new Set<string>();
  constructor() {
    super();
    const r = this.attachShadow({ mode: "open" });
    r.innerHTML = '<input type="text" />';
    this._input = r.querySelector("input")!;
    this._input.addEventListener("input", () => {
      const q = this._input.value;
      setTimeout(() => this._render(q), 5); // async suggestion fetch
    });
  }
  _clear() {
    for (const el of Array.from(this.querySelectorAll("sugg-item"))) el.remove();
  }
  _render(query: string) {
    this._clear();
    const q = query.trim().toLowerCase();
    if (!q) return;
    for (const label of TAXONOMY.filter((t) => t.toLowerCase().includes(q) && !this.selected.has(t))) {
      const item = document.createElement("sugg-item");
      const sr = item.attachShadow({ mode: "open" });
      sr.innerHTML = '<span role="option"></span>';
      const span = sr.querySelector("span")!;
      span.textContent = label;
      span.addEventListener("click", () => this._commit(label));
      this.appendChild(item);
    }
  }
  _commit(label: string) {
    this.selected.add(label);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(this._input, "");
    this._clear();
  }
}
class SuggItem extends HTMLElement {}
if (!customElements.get("skill-input")) customElements.define("skill-input", SkillInput);
if (!customElements.get("sugg-item")) customElements.define("sugg-item", SuggItem);

describe("fillSkills — per-skill typeahead loop through shadow DOM", () => {
  let host: SkillInput;
  beforeEach(() => {
    document.body.innerHTML = "<div id=host><skill-input></skill-input></div>";
    host = document.querySelector("skill-input") as SkillInput;
  });

  it("tags every skill that has a matching option and reports the ones it can't", async () => {
    const res = await fillSkills(host, ["C++", "C", "Linux", "CUDA", "Floating-point arithmetic"]);
    expect(res.filled).toEqual(["C++", "C", "Linux", "CUDA"]);
    expect(res.skipped).toEqual(["Floating-point arithmetic"]);
    expect(Array.from(host.selected).sort()).toEqual(["C", "C++", "CUDA", "Linux"]);
  });

  it("tags 'C' as C — never as C++ or C# (verified selection)", async () => {
    const res = await fillSkills(host, ["C"]);
    expect(res.filled).toEqual(["C"]);
    expect(host.selected.has("C")).toBe(true);
    expect(host.selected.has("C++")).toBe(false);
    expect(host.selected.has("C#")).toBe(false);
  });

  it("finds the input through the shadow root (light-DOM query would miss it)", async () => {
    expect(host.querySelector("input")).toBeNull(); // input is in shadow DOM
    const res = await fillSkills(host, ["Python"]);
    expect(res.filled).toEqual(["Python"]);
  });

  it("returns an empty result for an empty skill list", async () => {
    const res = await fillSkills(host, []);
    expect(res).toEqual({ filled: [], skipped: [] });
  });
});
