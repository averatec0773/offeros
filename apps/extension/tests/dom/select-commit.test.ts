// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { verifyCommitted } from "../../src/lib/autofill/select-commit";

// DOM shape observed live on job-boards.greenhouse.io/embed/job_app (new UI):
// a react-select with classNamePrefix "select" whose single-value node renders
// the committed choice — for the country dial-code select, as just "+1" even
// though the chosen option's menu label is "United States +1".
function ghCombobox(singleValueText: string | null): HTMLInputElement {
  document.body.innerHTML = `
    <div class="select-wrap">
      <div class="select__control remix-css-13cymwt-control">
        <div class="select__value-container">
          ${
            singleValueText === null
              ? ""
              : `<div class="select__single-value remix-css-x">${singleValueText}</div>`
          }
          <div class="select__input-container" data-value="">
            <input id="country" class="select__input" type="text" role="combobox"
                   aria-autocomplete="list" />
          </div>
        </div>
      </div>
    </div>`;
  return document.querySelector("input")!;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("verifyCommitted — Greenhouse new-UI select rendering", () => {
  it("accepts a rendering that matches the chosen option's label, not the wanted value", () => {
    // The systematic country failure: profile value "United States", option
    // "United States +1" selected and committed, widget renders "+1".
    const input = ghCombobox("+1");
    expect(verifyCommitted(input, "United States", true, "United States +1")).toBe(true);
  });

  it("still accepts a rendering that matches the wanted value directly", () => {
    const input = ghCombobox("Male");
    expect(verifyCommitted(input, "Male", true)).toBe(true);
  });

  it("rejects a rendering that matches neither the value nor the chosen label", () => {
    const input = ghCombobox("+44");
    expect(verifyCommitted(input, "United States", true, "United States +1")).toBe(false);
  });

  it("rejects an empty rendering even with a chosen label", () => {
    const input = ghCombobox("");
    expect(verifyCommitted(input, "United States", true, "United States +1")).toBe(false);
  });

  it("strict mode requires the single-value node; tolerant mode does not", () => {
    const input = ghCombobox(null);
    expect(verifyCommitted(input, "United States", true, "United States +1")).toBe(false);
    expect(verifyCommitted(input, "United States", false, "United States +1")).toBe(true);
  });
});
