// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { findFileInputNear, scanFields } from "../../src/lib/autofill/dom-fill";
import { GENERIC_RECIPE } from "../../src/lib/autofill/recipes";

/**
 * The résumé upload that OfferOS could not see.
 *
 * A custom uploader hides the native `<input type="file">` and renders its own
 * button over it, because the native control cannot be styled. On a real form
 * that input had an empty id and a name ending `_file`, and it was invisible —
 * so the scan skipped it as hidden, no field existed to attach to, and the
 * résumé was silently never uploaded.
 *
 * A file input is the one control routinely hidden on purpose. Everything else
 * hidden is still skipped.
 */

beforeEach(() => {
  document.body.innerHTML = "";
});

const scan = () => scanFields(document.body, GENERIC_RECIPE).map((f) => f.descriptor);

const CUSTOM_UPLOADER = `<main><form>
  <div class="crc-rec-form_9001 row" cx-prop-label="Resume/CV">
    <div class="lyte-fileupload">
      <button type="button">Choose file</button>
      <input type="file" id="" name="rec-form_9001_file" style="display:none" />
    </div>
  </div>
  <div class="crm-row">
    <label class="crm-from-label">Email *</label>
    <input id="" name="rec-form_9002" type="email" />
  </div>
</form></main>`;

describe("a hidden file input behind a custom uploader", () => {
  it("is scanned, and reads the label of the region it sits in", () => {
    document.body.innerHTML = CUSTOM_UPLOADER;
    const found = scan();
    const file = found.find((d) => d.type === "file");
    expect(file).toBeTruthy();
    expect(file!.label).toBe("Resume/CV");
  });

  it("everything else hidden is still skipped", () => {
    // The exception is for file inputs specifically, not for hidden fields.
    document.body.innerHTML = `<main><form>
      <input id="secret" name="tracking" type="text" style="display:none" />
      <div class="crm-row">
        <label class="crm-from-label">Email *</label>
        <input id="" name="rec-form_1" type="email" />
      </div>
    </form></main>`;
    expect(scan().map((d) => d.name)).toEqual(["rec-form_1"]);
  });
});

describe("finding the input a wrapper hides", () => {
  it("reaches the native control from the component around it", () => {
    document.body.innerHTML = CUSTOM_UPLOADER;
    const wrapper = document.querySelector<HTMLElement>(".lyte-fileupload")!;
    expect(findFileInputNear(wrapper)?.name).toBe("rec-form_9001_file");
  });

  it("reaches it from a wrapper several levels above", () => {
    document.body.innerHTML = CUSTOM_UPLOADER;
    const row = document.querySelector<HTMLElement>(".crc-rec-form_9001")!;
    expect(findFileInputNear(row)?.name).toBe("rec-form_9001_file");
  });

  it("returns the input itself when handed the input", () => {
    document.body.innerHTML = CUSTOM_UPLOADER;
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(findFileInputNear(input)).toBe(input);
  });

  it("never widens from an ordinary control", () => {
    // "Attach to the name field" must not quietly attach to whatever upload
    // happens to be nearby.
    document.body.innerHTML = CUSTOM_UPLOADER;
    const email = document.querySelector<HTMLElement>('input[type="email"]')!;
    expect(findFileInputNear(email)).toBeNull();
  });

  it("refuses to choose when a region holds two uploads", () => {
    document.body.innerHTML = `<main><form><div class="row">
      <div class="wrap"></div>
      <input type="file" name="a_file" />
      <input type="file" name="b_file" />
    </div></form></main>`;
    const wrap = document.querySelector<HTMLElement>(".wrap")!;
    expect(findFileInputNear(wrap)).toBeNull();
  });

  it("returns null when there is no upload anywhere near", () => {
    document.body.innerHTML = `<main><form><div class="wrap"></div></form></main>`;
    expect(findFileInputNear(document.querySelector<HTMLElement>(".wrap")!)).toBeNull();
  });
});
