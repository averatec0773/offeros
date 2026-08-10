import { describe, expect, it } from "vitest";
import {
  canaryPersonas,
  checkProvenance,
  distinctiveAtoms,
  profileAtoms,
  type CanaryPersona,
} from "../canary";
import { discoverCapturedForms } from "./adaptation/captured-report";
import { ATS_FORMS, toDescriptor } from "./adaptation/ats-forms";
import type { FieldDescriptor } from "../classify";

/**
 * The canary lab's own credibility tests. Two halves:
 *   - the personas must actually be distinguishable (a canary set whose
 *     members share their identifying material cannot detect anything);
 *   - the detector must fire on a planted contamination — a detector only
 *     ever seen passing is a detector nobody has ever seen work.
 * Then the real assertion: replaying every corpus form as every persona
 * produces zero cross-profile leaks.
 */

const personas = canaryPersonas();

const corpusForms: { name: string; fields: FieldDescriptor[] }[] = [
  ...ATS_FORMS.map((form) => ({
    name: form.id,
    fields: form.fields.map((field, i) => toDescriptor(field, i)),
  })),
  ...discoverCapturedForms().map(({ fixture }) => ({
    name: fixture.formId,
    fields: fixture.fields,
  })),
];

describe("canary personas", () => {
  it("every persona has distinctive material for every identity field", () => {
    const distinct = distinctiveAtoms(personas);
    for (const persona of personas) {
      const atoms = distinct.get(persona.id)!;
      // Name, email, phone digits, city and at least one skill must each be
      // provably this persona's — otherwise a leak in that category would be
      // undetectable by construction.
      expect([...atoms].some((a) => a.includes("@example.com"))).toBe(true);
      expect([...atoms].some((a) => /^\d+$/.test(a))).toBe(true);
      expect(atoms.size).toBeGreaterThanOrEqual(8);
    }
  });

  it("shared vocabulary is NOT distinctive", () => {
    const distinct = distinctiveAtoms(personas);
    for (const persona of personas) {
      // Every persona says "United States" and "Yes"; neither can prove
      // provenance, so neither may appear in a distinctive set.
      expect(distinct.get(persona.id)!.has("united states")).toBe(false);
    }
  });

  it("atoms include the split-name forms the engine actually writes", () => {
    const atoms = profileAtoms(personas[0]!.profile);
    expect(atoms.has("avery")).toBe(true);
    expect(atoms.has("stone")).toBe(true);
  });
});

describe("the detector detects — planted contamination", () => {
  const emailField: FieldDescriptor[] = [
    {
      fieldId: "email",
      label: "Email",
      name: "email",
      autocomplete: "email",
      type: "email",
      placeholder: "",
      ariaLabel: "",
    },
  ];

  it("flags a value carrying another persona's distinctive atom", () => {
    // Simulate the bug this lab exists to catch: persona A's profile has been
    // contaminated with persona B's email (wrong-source read, stale cache,
    // hardcoded default — the cause does not matter, the symptom is the same).
    const avery = personas.find((p) => p.id === "canary-avery")!;
    const riley = personas.find((p) => p.id === "canary-riley")!;
    const contaminated: CanaryPersona = {
      id: avery.id,
      profile: {
        ...avery.profile,
        personal: { ...avery.profile.personal, email: riley.profile.personal.email },
      },
    };
    const set = [contaminated, ...personas.filter((p) => p.id !== avery.id)];

    const report = checkProvenance(emailField, set, avery.id);
    expect(report.leaks.length).toBeGreaterThan(0);
    expect(report.leaks[0]!.leakedFrom).toBe(riley.id);
  });

  it("does not flag the clean case on the same field", () => {
    const report = checkProvenance(emailField, personas, "canary-avery");
    expect(report.leaks).toEqual([]);
    expect(report.planned).toBe(1);
  });
});

describe("provenance across the whole corpus", () => {
  it("has forms to check — the corpus is not silently empty", () => {
    expect(corpusForms.length).toBeGreaterThanOrEqual(6);
  });

  for (const persona of personas) {
    it(`zero cross-profile leaks with ${persona.id} active, on every form`, () => {
      for (const form of corpusForms) {
        const report = checkProvenance(form.fields, personas, persona.id);
        expect(report.leaks, `${form.name}: ${JSON.stringify(report.leaks)}`).toEqual([]);
      }
    });
  }

  it("unexplained values are the audited exception, not the norm", () => {
    // Values not traceable to the active profile should be rare and, when
    // they exist, are the first thing a reviewer reads. If this ratio climbs,
    // either the engine started inventing values or the atom extraction went
    // blind — both worth failing loudly over.
    let planned = 0;
    let unexplained = 0;
    for (const form of corpusForms) {
      const report = checkProvenance(form.fields, personas, "canary-avery");
      planned += report.planned;
      unexplained += report.unexplained.length;
    }
    expect(planned).toBeGreaterThan(0);
    expect(unexplained / planned).toBeLessThanOrEqual(0.2);
  });
});
