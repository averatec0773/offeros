// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { applyFill, scanFields, setControlledValue } from "../../src/lib/autofill/dom-fill";
import { matchAts } from "../../src/lib/autofill/recipes";

const recipe = matchAts("https://boards.greenhouse.io/acme/jobs/1")!;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("scanFields — shadow-aware (myworkday)", () => {
  const workday = matchAts("https://intel.wd1.myworkdayjobs.com/External/job/x/apply")!;

  it("discovers an input inside a shadow root and prunes the extension overlay", () => {
    // Workday's skills input lives in a web component's shadow root.
    class WdSkill extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML =
          '<input type="text" name="skills" aria-label="Skills" />';
      }
    }
    if (!customElements.get("wd-skill")) customElements.define("wd-skill", WdSkill);

    document.body.innerHTML = "";
    const app = document.createElement("div");
    app.innerHTML = "<input name='email' type='email' /><wd-skill></wd-skill>";
    document.body.appendChild(app);

    // the extension's own overlay, with an input in its shadow root — must be skipped
    const overlay = document.createElement("offeros-overlay");
    overlay.attachShadow({ mode: "open" }).innerHTML = '<input name="draft" type="text" />';
    document.body.appendChild(overlay);

    const found = scanFields(document.body, workday);
    const names = found.map((f) => f.descriptor.name).sort();
    expect(names).toContain("skills"); // shadow input discovered
    expect(names).toContain("email"); // light input still found
    expect(names).not.toContain("draft"); // overlay input pruned
  });

  it("leaves light-DOM ATSs unchanged (no shadow traversal for greenhouse)", () => {
    document.body.innerHTML = "";
    const overlay = document.createElement("offeros-overlay");
    overlay.attachShadow({ mode: "open" }).innerHTML = '<input name="draft" type="text" />';
    document.body.appendChild(overlay);
    document.body.insertAdjacentHTML("afterbegin", "<form><input name='email' type='email' /></form>");
    const found = scanFields(document.body, recipe); // greenhouse recipe, no pierceShadow
    const names = found.map((f) => f.descriptor.name);
    expect(names).toEqual(["email"]);
  });
});

describe("scanFields", () => {
  it("extracts descriptors with resolved labels and assigns stable ids", () => {
    document.body.innerHTML = `
      <main><form>
        <label for="e">Email address</label>
        <input id="e" name="email" autocomplete="email" type="email" />
        <label>Phone<input name="phone" type="tel" /></label>
        <input type="hidden" name="csrf" />
      </form></main>`;
    const found = scanFields(document.body, recipe);
    // hidden input excluded by the field selector
    expect(found).toHaveLength(2);
    const byName = Object.fromEntries(found.map((f) => [f.descriptor.name, f.descriptor]));
    expect(byName["email"]!.label).toBe("Email address");
    expect(byName["email"]!.autocomplete).toBe("email");
    expect(byName["phone"]!.label).toBe("Phone");
    // each element carries the assigned data attribute matching its descriptor id
    for (const f of found) {
      expect(f.el.getAttribute("data-offeros-id")).toBe(f.descriptor.fieldId);
    }
  });
});

describe("labelFor via scanFields", () => {
  it("strips nested option text from wrapping labels (Lever EEO selects)", () => {
    document.body.innerHTML = `
      <main><form><label>Gender
        <select name="eeo[gender]"><option>Select ...</option><option>Male</option><option>Female</option></select>
      </label></form></main>`;
    const [f] = scanFields(document.body, recipe);
    expect(f!.descriptor.label).toBe("Gender");
  });
});

describe("required detection via scanFields", () => {
  it("flags required from the attribute, aria-required, and a '*' label; else false", () => {
    document.body.innerHTML = `
      <main><form>
        <label for="a">First name</label><input id="a" name="a" required />
        <label for="b">Email</label><input id="b" name="b" aria-required="true" />
        <label for="c">Phone *</label><input id="c" name="c" />
        <label for="d">Website</label><input id="d" name="d" />
      </form></main>`;
    const byName = Object.fromEntries(
      scanFields(document.body, recipe).map((f) => [f.descriptor.name, f.descriptor]),
    );
    expect(byName["a"]!.required).toBe(true);
    expect(byName["b"]!.required).toBe(true);
    expect(byName["c"]!.required).toBe(true);
    expect(byName["d"]!.required).toBe(false);
  });
});

describe("setControlledValue", () => {
  it("sets the value and dispatches input+change so React-controlled inputs update", () => {
    document.body.innerHTML = `<input id="x" />`;
    const el = document.getElementById("x") as HTMLInputElement;
    const events: string[] = [];
    el.addEventListener("input", () => events.push("input"));
    el.addEventListener("change", () => events.push("change"));
    setControlledValue(el, "hello");
    expect(el.value).toBe("hello");
    expect(events).toEqual(["input", "change"]);
  });

  it("selects a matching option on a <select>", () => {
    document.body.innerHTML = `<select id="s"><option value="">–</option><option value="Yes">Yes</option></select>`;
    const el = document.getElementById("s") as HTMLSelectElement;
    setControlledValue(el, "Yes");
    expect(el.value).toBe("Yes");
  });
});

describe("scanFields visibility filter", () => {
  it("skips recaptcha, hidden, and aria-hidden controls", () => {
    document.body.innerHTML = `
      <main><form>
        <input name="visible" />
        <textarea name="g-recaptcha-response"></textarea>
        <input name="hidden-style" style="display:none" />
        <div aria-hidden="true"><input name="aria-hidden-child" /></div>
      </form></main>`;
    const names = scanFields(document.body, recipe).map((f) => f.descriptor.name);
    expect(names).toEqual(["visible"]);
  });
});

describe("applyFill", () => {
  it("re-resolves elements from the live document (stale-ref survival)", async () => {
    document.body.innerHTML = `<main><form><label for="e">Email</label><input id="e" name="email" /></form></main>`;
    const [f] = scanFields(document.body, recipe);
    const id = f!.descriptor.fieldId;
    // simulate an SPA re-render: the scanned node is replaced by a fresh one carrying the same attribute
    const old = f!.el as HTMLInputElement;
    const fresh = document.createElement("input");
    fresh.setAttribute("data-offeros-id", id);
    old.replaceWith(fresh);
    const filled = await applyFill(document, [{ fieldId: id, value: "a@b.c" }]);
    expect(filled).toBe(1);
    expect(fresh.value).toBe("a@b.c");
    expect(old.value).toBe(""); // the stale node was not written
  });

  it("skips fields whose element no longer exists and reports the true count", async () => {
    document.body.innerHTML = `<main><form><input name="a" /><input name="b" /></form></main>`;
    const found = scanFields(document.body, recipe);
    found[1]!.el.remove();
    const filled = await applyFill(
      document,
      found.map((f) => ({ fieldId: f.descriptor.fieldId, value: "x" })),
    );
    expect(filled).toBe(1);
  });

  it("never writes into a file input", async () => {
    document.body.innerHTML = `<main><form><input type="file" name="portfolio" /></form></main>`;
    const [f] = scanFields(document.body, recipe);
    const filled = await applyFill(document, [{ fieldId: f!.descriptor.fieldId, value: "evil" }]);
    expect(filled).toBe(0);
  });
});

describe("applyFill combobox routing", () => {
  const comboDom = () => {
    document.body.innerHTML = `<main><form>
      <input name="plain" />
      <input name="combo" role="combobox" aria-autocomplete="list" />
    </form></main>`;
    return scanFields(document.body, recipe);
  };

  it("counts a combobox only when the driver confirms", async () => {
    const found = comboDom();
    const seen: string[] = [];
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as { kind?: string; fieldId?: string; value?: string };
      if (d?.kind === "offeros:combobox-fill") {
        seen.push(d.value ?? "");
        window.postMessage({ kind: "offeros:combobox-result", fieldId: d.fieldId, ok: true }, "*");
      }
    };
    window.addEventListener("message", onMsg);
    const filled = await applyFill(
      document,
      found.map((f) => ({ fieldId: f.descriptor.fieldId, value: "Yes" })),
      { comboTimeoutMs: 500 },
    );
    window.removeEventListener("message", onMsg);
    expect(filled).toBe(2); // plain text + confirmed combobox
    expect(seen).toEqual(["Yes"]);
  });

  it("does not count a combobox when no driver answers (timeout)", async () => {
    const found = comboDom();
    const filled = await applyFill(
      document,
      found.map((f) => ({ fieldId: f.descriptor.fieldId, value: "Yes" })),
      { comboTimeoutMs: 50 },
    );
    expect(filled).toBe(1); // only the plain text input
  });

  it("does not count a combobox when the driver reports failure", async () => {
    const found = comboDom();
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as { kind?: string; fieldId?: string };
      if (d?.kind === "offeros:combobox-fill") {
        window.postMessage({ kind: "offeros:combobox-result", fieldId: d.fieldId, ok: false }, "*");
      }
    };
    window.addEventListener("message", onMsg);
    const filled = await applyFill(
      document,
      found.map((f) => ({ fieldId: f.descriptor.fieldId, value: "Yes" })),
      { comboTimeoutMs: 500 },
    );
    window.removeEventListener("message", onMsg);
    expect(filled).toBe(1);
  });
});
