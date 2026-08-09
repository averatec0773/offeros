// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { scanFields } from "../../src/lib/autofill/dom-fill";
import { toFieldMeta, type FieldMeta } from "@offeros/autofill";
import { matchAts } from "../../src/lib/autofill/recipes";

/**
 * The measured failure this exists to prevent: OpenAI's Ashby form renders Race
 * as eight checkboxes, and the DOM-proximity grouping delivered eight separate
 * unknown fields. The ATS itself calls them one question.
 */
const recipe = matchAts("https://jobs.ashbyhq.com/openai/abc/application")!;

function form(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

const meta = (question: string, groupId: string, options: string[]): FieldMeta =>
  toFieldMeta({
    question,
    platformType: "ValueSelect",
    groupId,
    required: true,
    options,
    source: "props",
  })!;

describe("scanFields with the ATS's own field metadata", () => {
  const RACE = ["Asian", "Black or African American", "White", "Decline to self-identify"];

  it("collapses one question's controls into one field", () => {
    const root = form(
      RACE.map(
        (o, i) =>
          `<label>${o}<input type="checkbox" id="race-labeled-checkbox-${i}" name="r${i}"></label>`,
      ).join(""),
    );
    const boxes = Array.from(root.querySelectorAll<HTMLElement>("input"));
    const byEl = new Map<Element, FieldMeta>(boxes.map((b) => [b, meta("Race", "race-id", RACE)]));

    const scanned = scanFields(root, recipe, byEl);

    expect(scanned).toHaveLength(1);
    const d = scanned[0]!.descriptor;
    expect(d.label).toBe("Race");
    expect(d.options).toEqual(RACE);
    expect(d.required).toBe(true);
    expect(d.type).toBe("radio-group");
  });

  it("uses the platform's question text, not the scraped label", () => {
    // The visible label here is an option; only the metadata knows the question.
    const root = form(`<label>Asian<input type="checkbox" id="x-labeled-checkbox-0"></label>`);
    const el = root.querySelector<HTMLElement>("input")!;
    const scanned = scanFields(root, recipe, new Map([[el, meta("Race", "race-id", RACE)]]));
    expect(scanned[0]!.descriptor.label).toBe("Race");
  });

  it("without metadata, behaves exactly as before", () => {
    // Lever exposes nothing; that path must not change.
    const root = form(
      `<label>First name<input type="text" name="first"></label>
       <label>Last name<input type="text" name="last"></label>`,
    );
    const withNone = scanFields(root, recipe, new Map());
    const withUndefined = scanFields(root, recipe);
    expect(withNone.map((s) => s.descriptor.label)).toEqual(
      withUndefined.map((s) => s.descriptor.label),
    );
    expect(withNone).toHaveLength(2);
  });

  it("leaves fields the ATS said nothing about to the heuristics", () => {
    const root = form(
      `<label>Race<input type="checkbox" id="race-labeled-checkbox-0"></label>
       <label>Why do you want this job?<textarea name="why"></textarea></label>`,
    );
    const box = root.querySelector<HTMLElement>("input")!;
    const scanned = scanFields(root, recipe, new Map([[box, meta("Race", "race-id", RACE)]]));
    const labels = scanned.map((s) => s.descriptor.label);
    expect(labels).toContain("Race");
    expect(labels).toContain("Why do you want this job?");
  });
});
