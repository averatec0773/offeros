// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyFillDetailed,
  attachFile,
  scanFields,
  setControlledValue,
  type FillValue,
} from "../../src/lib/autofill/dom-fill";

// The old thin `applyFill` wrapper was deleted; tests keep its shape locally.
const applyFill = async (
  doc: Document,
  values: FillValue[],
  opts?: { comboTimeoutMs?: number; skillsTimeoutMs?: number },
) => (await applyFillDetailed(doc, values, opts)).filled;
import { matchAts } from "../../src/lib/autofill/recipes";

const recipe = matchAts("https://boards.greenhouse.io/acme/jobs/1")!;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("scanFields — shadow-aware (myworkday)", () => {
  const workday = matchAts("https://intel.wd1.myworkdayjobs.com/External/job/x/apply")!;

  it("discovers an input inside a shadow root", () => {
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

    const found = scanFields(document.body, workday);
    const names = found.map((f) => f.descriptor.name).sort();
    expect(names).toContain("skills"); // shadow input discovered
    expect(names).toContain("email"); // light input still found
  });

  it("leaves light-DOM ATSs unchanged (no shadow traversal for greenhouse)", () => {
    document.body.innerHTML = "";
    const shadowHost = document.createElement("some-widget");
    shadowHost.attachShadow({ mode: "open" }).innerHTML = '<input name="draft" type="text" />';
    document.body.appendChild(shadowHost);
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

  it("falls back to the element id as the name signal when name is absent (real Greenhouse file inputs)", () => {
    document.body.innerHTML = `
      <main><form>
        <input id="resume" type="file" />
        <input id="cover_letter" type="file" />
      </form></main>`;
    const found = scanFields(document.body, recipe);
    expect(found.map((f) => f.descriptor.name)).toEqual(["resume", "cover_letter"]);
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

describe("attachFile", () => {
  it("assigns the file to input.files, dispatches input+change, and verifies it took", () => {
    document.body.innerHTML = `<input type="file" name="resume" />`;
    const input = document.querySelector("input")! as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener("input", () => events.push("input"));
    input.addEventListener("change", () => events.push("change"));
    const file = new File(["%PDF-1.4 fake"], "Jordan_Rivera_Resume.pdf", { type: "application/pdf" });

    const ok = attachFile(input, file);

    expect(ok).toBe(true);
    expect(events).toEqual(["input", "change"]);
    expect(input.files).toHaveLength(1);
    expect(input.files?.[0]?.name).toBe("Jordan_Rivera_Resume.pdf");
  });

  it("returns false when the assignment doesn't verify (site ignores the write, reads back empty)", () => {
    document.body.innerHTML = `<input type="file" name="resume" />`;
    const input = document.querySelector("input")! as HTMLInputElement;
    // Simulate a site/browser that silently swallows the programmatic
    // assignment: the setter is a no-op, the getter always reads back empty.
    const emptyFiles = new DataTransfer().files;
    Object.defineProperty(input, "files", {
      get: () => emptyFiles,
      set: () => {},
      configurable: true,
    });
    const file = new File(["x"], "resume.pdf", { type: "application/pdf" });

    expect(attachFile(input, file)).toBe(false);
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

describe("choice-group scanning and filling", () => {
  it("collapses same-name radios into one group descriptor with the question label", () => {
    document.body.innerHTML = `
      <main><form>
        <div>
          <div>What is your gender?</div>
          <div>
            <label><input type="radio" name="eeo_gender" value="m" /><span>Male</span></label>
            <label><input type="radio" name="eeo_gender" value="f" /><span>Female</span></label>
            <label><input type="radio" name="eeo_gender" value="d" /><span>Decline to self-identify</span></label>
          </div>
        </div>
      </form></main>`;
    const found = scanFields(document.body, recipe);
    expect(found).toHaveLength(1);
    const d = found[0]!.descriptor;
    expect(d.type).toBe("radio-group");
    expect(d.label).toBe("What is your gender?");
    expect(d.options).toEqual(["Male", "Female", "Decline to self-identify"]);
  });

  it("collapses Ashby-style labeled-checkbox rows into one group", () => {
    document.body.innerHTML = `
      <main><form>
        <div>
          <div>Which office are you interested in?</div>
          <div>
            <label><input type="checkbox" id="q1-labeled-checkbox-0" name="Remote (U.S.)" /><span>Remote (U.S.)</span></label>
            <label><input type="checkbox" id="q1-labeled-checkbox-1" name="Austin Office" /><span>Austin Office</span></label>
          </div>
        </div>
      </form></main>`;
    const found = scanFields(document.body, recipe);
    expect(found).toHaveLength(1);
    expect(found[0]!.descriptor.type).toBe("checkbox-group");
    expect(found[0]!.descriptor.options).toEqual(["Remote (U.S.)", "Austin Office"]);
  });

  it("fills a radio group by clicking the option matching the value", async () => {
    document.body.innerHTML = `
      <main><form>
        <div>
          <div>Do you consent?</div>
          <div>
            <label><input type="radio" name="consent" value="y" /><span>Yes - I consent</span></label>
            <label><input type="radio" name="consent" value="n" /><span>No - I do not consent</span></label>
          </div>
        </div>
      </form></main>`;
    const [group] = scanFields(document.body, recipe);
    const filled = await applyFill(document, [
      { fieldId: group!.descriptor.fieldId, value: "Yes - I consent" },
    ]);
    expect(filled).toBe(1);
    const yes = document.querySelector('input[value="y"]') as HTMLInputElement;
    expect(yes.checked).toBe(true);
  });

  it("skips zero-signal controls entirely (unlabeled bare file input)", () => {
    document.body.innerHTML = `
      <main><form>
        <input type="file" />
        <label for="e">Email</label><input id="e" name="email" type="email" />
      </form></main>`;
    const names = scanFields(document.body, recipe).map((f) => f.descriptor.name);
    expect(names).toEqual(["email"]);
  });
});

describe("stable field ids across content-script reloads", () => {
  const FORM = `
      <main><form>
        <label for="e">Email</label><input id="e" name="email" type="email" />
        <label for="p">Phone</label><input id="p" name="phone" type="tel" />
        <label for="w">Website</label><input id="w" name="website" type="text" />
      </form></main>`;

  it("the same logical field gets the same id on every fresh scan (reload survival)", () => {
    document.body.innerHTML = FORM;
    const first = Object.fromEntries(
      scanFields(document.body, recipe).map((f) => [f.descriptor.label, f.descriptor.fieldId]),
    );
    // Simulate a content-script reload: identical DOM rebuilt from scratch.
    document.body.innerHTML = FORM;
    const second = Object.fromEntries(
      scanFields(document.body, recipe).map((f) => [f.descriptor.label, f.descriptor.fieldId]),
    );
    expect(second).toEqual(first);
  });

  it("reordered fields keep their ids attached to their content, not their position", () => {
    document.body.innerHTML = FORM;
    const byLabel = Object.fromEntries(
      scanFields(document.body, recipe).map((f) => [f.descriptor.label, f.descriptor.fieldId]),
    );
    document.body.innerHTML = `
      <main><form>
        <label for="w">Website</label><input id="w" name="website" type="text" />
        <label for="e">Email</label><input id="e" name="email" type="email" />
        <label for="p">Phone</label><input id="p" name="phone" type="tel" />
      </form></main>`;
    const reordered = Object.fromEntries(
      scanFields(document.body, recipe).map((f) => [f.descriptor.label, f.descriptor.fieldId]),
    );
    expect(reordered).toEqual(byLabel);
  });

  it("true duplicates disambiguate deterministically by DOM order", () => {
    const DUP = `
      <main><form>
        <label>Reference<input name="ref" type="text" /></label>
        <label>Reference<input name="ref" type="text" /></label>
      </form></main>`;
    document.body.innerHTML = DUP;
    const ids = scanFields(document.body, recipe).map((f) => f.descriptor.fieldId);
    expect(ids[0]).not.toBe(ids[1]);
    document.body.innerHTML = DUP;
    const ids2 = scanFields(document.body, recipe).map((f) => f.descriptor.fieldId);
    expect(ids2).toEqual(ids);
  });
});

describe("label fallback for unlabeled custom widgets", () => {
  it("resolves the preceding title element (Ashby combobox: 'Location*' above an unlabeled input)", () => {
    document.body.innerHTML = `
      <main><form>
        <div>
          <div>Location*</div>
          <div><input type="text" placeholder="Start typing..." role="combobox" /></div>
        </div>
      </form></main>`;
    const [f] = scanFields(document.body, recipe);
    expect(f!.descriptor.label).toBe("Location*");
    expect(f!.descriptor.required).toBe(true);
  });

  it("never overrides a conventional label", () => {
    document.body.innerHTML = `
      <main><form>
        <div>
          <div>Some section heading</div>
          <label for="e">Email</label><input id="e" name="email" type="email" />
        </div>
      </form></main>`;
    const [f] = scanFields(document.body, recipe);
    expect(f!.descriptor.label).toBe("Email");
  });
});

describe("choice-group required detection", () => {
  it("reads the asterisk convention off the group question", () => {
    document.body.innerHTML = `
      <main><form>
        <div>
          <div>What is your highest level of education?*</div>
          <div>
            <label><input type="radio" name="edu" /><span>Bachelors</span></label>
            <label><input type="radio" name="edu" /><span>Masters</span></label>
          </div>
        </div>
      </form></main>`;
    const [g] = scanFields(document.body, recipe);
    expect(g!.descriptor.type).toBe("radio-group");
    expect(g!.descriptor.required).toBe(true);
  });
});

describe("required via title-element class (CSS-asterisk ATSes)", () => {
  it("marks a group required when its title carries a required class", () => {
    document.body.innerHTML = `
      <main><form>
        <div>
          <label class="_heading_x _required_y ashby-application-form-question-title">What is your gender?</label>
          <div>
            <label><input type="radio" name="g" /><span>Male</span></label>
            <label><input type="radio" name="g" /><span>Female</span></label>
          </div>
        </div>
      </form></main>`;
    const [g] = scanFields(document.body, recipe);
    expect(g!.descriptor.type).toBe("radio-group");
    expect(g!.descriptor.required).toBe(true);
  });

  it("marks an unlabeled combobox required via its preceding required-classed title", () => {
    document.body.innerHTML = `
      <main><form>
        <div>
          <label class="_required_f7cvd_91">Location</label>
          <div><input type="text" placeholder="Start typing..." /></div>
        </div>
      </form></main>`;
    const [f] = scanFields(document.body, recipe);
    expect(f!.descriptor.label).toBe("Location");
    expect(f!.descriptor.required).toBe(true);
  });

  it("a plain title without the class stays optional", () => {
    document.body.innerHTML = `
      <main><form>
        <div>
          <div>Nickname</div>
          <div><input type="text" placeholder="Type here..." /></div>
        </div>
      </form></main>`;
    const [f] = scanFields(document.body, recipe);
    expect(f!.descriptor.required).toBe(false);
  });
});

describe("Ashby yes/no widgets (hidden checkbox behind visible buttons)", () => {
  const ashby = matchAts("https://jobs.ashbyhq.com/acme/1/application")!;

  const mountYesNo = (labelCls = "_label_x _required_y") => {
    document.body.innerHTML = `
      <div class="_fieldEntry_a">
        <label class="${labelCls}">Are you authorized to work in the United States?</label>
        <div class="_container_1 _yesno_2">
          <input type="checkbox" name="uuid-auth-1" style="display:none">
          <button type="button" class="_option_a">Yes</button>
          <button type="button" class="_option_b">No</button>
        </div>
      </div>`;
    // Simulate the site's widget behavior: clicking a button marks it active
    // (async, like React) and syncs the hidden checkbox.
    const hidden = document.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    for (const btn of document.querySelectorAll("button")) {
      btn.addEventListener("click", () => {
        setTimeout(() => {
          for (const b of document.querySelectorAll("button")) b.classList.remove("_active_z");
          btn.classList.add("_active_z");
          hidden.checked = btn.textContent === "Yes";
        }, 30);
      });
    }
  };

  it("scans the widget as a radio-group with the question label and Yes/No options", () => {
    mountYesNo();
    const found = scanFields(document.body, ashby);
    const group = found.find((f) => f.descriptor.type === "radio-group");
    expect(group).toBeTruthy();
    expect(group!.descriptor.label).toBe("Are you authorized to work in the United States?");
    expect(group!.descriptor.options).toEqual(["Yes", "No"]);
    expect(group!.descriptor.required).toBe(true);
    // The HIDDEN checkbox itself must not surface as a separate field.
    expect(found.filter((f) => f.descriptor.name.includes("uuid-auth-1")).length).toBe(1);
  });

  it("fills by clicking the matching button and verifies via the active class", async () => {
    mountYesNo();
    const found = scanFields(document.body, ashby);
    const group = found.find((f) => f.descriptor.type === "radio-group")!;
    const { outcomes } = await applyFillDetailed(document, [
      { fieldId: group.descriptor.fieldId, value: "Yes" },
    ]);
    expect(outcomes.get(group.descriptor.fieldId)).toBe("filled");
    const yesBtn = [...document.querySelectorAll("button")].find((b) => b.textContent === "Yes")!;
    expect(/_active_/.test(yesBtn.className)).toBe(true);
    expect(document.querySelector<HTMLInputElement>("input[type=checkbox]")!.checked).toBe(true);
  });

  it("reports failed when no option matches the value", async () => {
    mountYesNo();
    const found = scanFields(document.body, ashby);
    const group = found.find((f) => f.descriptor.type === "radio-group")!;
    const { outcomes } = await applyFillDetailed(document, [
      { fieldId: group.descriptor.fieldId, value: "Purple" },
    ]);
    expect(outcomes.get(group.descriptor.fieldId)).toBe("failed");
  });

  it("carries the selected button as currentValue on rescan", async () => {
    mountYesNo();
    let found = scanFields(document.body, ashby);
    const group = found.find((f) => f.descriptor.type === "radio-group")!;
    await applyFillDetailed(document, [{ fieldId: group.descriptor.fieldId, value: "No" }]);
    found = scanFields(document.body, ashby);
    const rescanned = found.find((f) => f.descriptor.type === "radio-group")!;
    expect(rescanned.descriptor.currentValue).toBe("No");
  });
});

describe("native <select> fill honesty", () => {
  const mountCountrySelect = () => {
    document.body.innerHTML = `<main><form>
      <label for="c">Country</label>
      <select id="c" name="country">
        <option value="">Select…</option>
        <option value="US">United States</option>
        <option value="CA">Canada</option>
      </select>
    </form></main>`;
    return scanFields(document.body, recipe)[0]!.descriptor.fieldId;
  };

  it("resolves a human-readable value onto the option that carries it", async () => {
    // Real ATS country/state selects label options in words but value them as
    // codes; a raw assignment of "United States" is silently reset to "".
    const fieldId = mountCountrySelect();
    const { filled, outcomes } = await applyFillDetailed(document, [
      { fieldId, value: "United States" },
    ]);
    const el = document.getElementById("c") as HTMLSelectElement;
    expect(el.value).toBe("US");
    expect(outcomes.get(fieldId)).toBe("filled");
    expect(filled).toBe(1);
  });

  it("reports failed — never filled — when no option matches", async () => {
    const fieldId = mountCountrySelect();
    const { filled, outcomes } = await applyFillDetailed(document, [
      { fieldId, value: "Atlantis" },
    ]);
    const el = document.getElementById("c") as HTMLSelectElement;
    expect(el.value).toBe(""); // the page holds nothing…
    expect(outcomes.get(fieldId)).toBe("failed"); // …and we say so
    expect(filled).toBe(0);
  });
});
