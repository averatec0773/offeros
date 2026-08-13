// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { scanFields } from "../../src/lib/autofill/dom-fill";
import { GENERIC_RECIPE } from "../../src/lib/autofill/recipes";
import { buildFillPlan, CAPTCHA_REASON, explainFillPlan } from "@offeros/autofill";
import { handoverList } from "../../src/lib/autofill/task-mode";

/**
 * Things on a form that are not questions.
 *
 * A composite control is built out of inputs, and scanning its parts turns one
 * question into three. A dropdown mid-fetch shows text that is a state, not a
 * label. And a CAPTCHA is a question — just never ours.
 */

beforeEach(() => {
  document.body.innerHTML = "";
});

const scan = () => scanFields(document.body, GENERIC_RECIPE).map((f) => f.descriptor);

describe("a widget's own machinery", () => {
  it("does not list a country-code picker's search box as a question", () => {
    // Seen verbatim on a real form: "Search country with dial code" appeared in
    // the panel as something the applicant had been asked.
    document.body.innerHTML = `<main><form>
      <div class="crm-row">
        <label class="crm-from-label">Phone *</label>
        <div class="dropdown">
          <input id="dial-search" placeholder="Search country with dial code" />
          <div role="listbox"><div role="option">+1 United States</div></div>
        </div>
        <input id="rec-form_phone" />
      </div>
    </form></main>`;
    const ids = scan().map((d) => d.fieldId);
    expect(ids).toHaveLength(1);
    expect(scan()[0]!.label).toBe("Phone *");
  });

  it("does not list an input that lives inside a listbox", () => {
    document.body.innerHTML = `<main><form>
      <div role="listbox"><input id="inside-popup" name="filter" /></div>
      <div class="crm-row">
        <label class="crm-from-label">Country</label>
        <input id="rec-form_country" />
      </div>
    </form></main>`;
    expect(scan().map((d) => d.fieldId)).toEqual([scan()[0]!.fieldId]);
    expect(scan()[0]!.label).toBe("Country");
  });

  it("leaves an ordinary field with the word search in its label alone", () => {
    // "Search" as a widget's filter is noise; "Job search status" is a question.
    document.body.innerHTML = `<main><form>
      <div class="crm-row">
        <label class="crm-from-label">Current job search status</label>
        <input id="rec-form_status" />
      </div>
    </form></main>`;
    expect(scan()).toHaveLength(1);
  });
});

describe("a dropdown caught mid-fetch", () => {
  it("does not turn its transient rows into fields", () => {
    document.body.innerHTML = `<main><form>
      <div class="crm-row">
        <label class="crm-from-label">University</label>
        <div class="select">
          <input id="rec-form_uni" />
          <div role="listbox">
            <div role="option">Loading</div>
            <div role="option">No Results Found</div>
          </div>
        </div>
      </div>
    </form></main>`;
    const found = scan();
    expect(found).toHaveLength(1);
    expect(found[0]!.label).toBe("University");
  });
});

/**
 * A CAPTCHA is a site asking whether a person is present. Answering it for the
 * applicant would be lying to the employer on their behalf. OfferOS does not
 * try, and there is no path here that calls a solving service — a discipline,
 * not a missing capability.
 */
describe("a CAPTCHA", () => {
  const mountCaptcha = () => {
    document.body.innerHTML = `<main><form>
      <div class="crm-row">
        <label class="crm-from-label">Type below image text</label>
        <input id="rec-form_captcha" />
      </div>
      <div class="crm-row">
        <label class="crm-from-label">Email *</label>
        <input id="rec-form_email" type="email" />
      </div>
    </form></main>`;
    return scan();
  };

  const profile = {
    personal: {
      name: "Jordan Rivera",
      email: "jordan@example.com",
      phone: "",
      address: "",
      links: {},
    },
    skills: [],
    answerBank: [],
    education: [],
    experience: [],
  };

  it("is never filled, whatever the profile holds", () => {
    const plan = buildFillPlan(mountCaptcha(), profile);
    const captcha = plan.find((i) => i.label === "Type below image text")!;
    expect(captcha.captcha).toBe(true);
    expect(captcha.status).toBe("needs-answer");
    expect(captcha.value).toBe("");
    // And it does not stop the rest of the form being filled.
    expect(plan.find((i) => i.label === "Email *")!.status).toBe("fillable");
  });

  it("says why, in the words the user reads", () => {
    const { trace } = explainFillPlan(mountCaptcha(), profile);
    const captcha = trace.find((t) => t.label === "Type below image text")!;
    expect(captcha.reason).toBe(CAPTCHA_REASON);
    expect(captcha.reason).toMatch(/will not do it for you/i);
  });

  it("lands on the list of fields that are the user's", () => {
    const plan = buildFillPlan(mountCaptcha(), profile);
    const list = handoverList(plan, [], new Set());
    const row = list.find((f) => f.label === "Type below image text");
    expect(row).toBeTruthy();
    expect(row!.reason).toBe(CAPTCHA_REASON);
  });
});

/**
 * Whether a control is resting on its default is evidence in BOTH directions.
 *
 * The scan is the only place that can see the difference between a prompt row
 * and a real option that happens to read like one. Emitting the flag only when
 * it is true left everything else looking undecided, and a text pattern then
 * got the last word on answers it had no business judging.
 */
describe("what the scan says about a control's default", () => {
  const flagFor = (html: string) => {
    document.body.innerHTML = `<main><form>${html}</form></main>`;
    return scan()[0]?.currentValueIsPlaceholder;
  };

  it("a select on its prompt row is a placeholder", () => {
    expect(
      flagFor(
        `<label for="a">Veteran Status</label>
         <select id="a"><option value="" selected>-None-</option><option value="no">No</option></select>`,
      ),
    ).toBe(true);
  });

  it("a select on a real option is NOT a placeholder, whatever it reads", () => {
    expect(
      flagFor(
        `<label for="b">Veteran Status</label>
         <select id="b"><option value="">-None-</option><option value="u" selected>Unknown</option></select>`,
      ),
    ).toBe(false);
  });

  it("text somebody typed is an answer, even when it reads like a placeholder", () => {
    expect(flagFor(`<label for="c">Source name</label><input id="c" value="N/A" />`)).toBe(false);
  });

  it("an empty box is left undecided rather than called an answer", () => {
    expect(flagFor(`<label for="d">Source name</label><input id="d" value="" />`)).toBeUndefined();
  });
});
