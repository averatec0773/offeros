// Scores autofill adaptation: how many of the standard application fields a
// resume HAS data for does the engine actually fill with the correct value,
// across every ATS form shape. Skipped controls (files, free-text, location)
// are excluded from the denominator but a wrongful fill into one is recorded
// separately as a false positive — a correctness regression, not a coverage one.

import { buildFillPlan } from "../../fill-plan";
import type { FillProfile } from "../../types";
import { ATS_FORMS, toDescriptor, type ExpectedTarget } from "./ats-forms";
import type { ResumeGroundTruth } from "./resume-corpus";

function emptyProfile(): FillProfile {
  return {
    personal: { name: "", email: "", phone: "", address: "", links: {} },
    skills: [],
    answerBank: [],
  };
}

export function profileFromGroundTruth(r: ResumeGroundTruth): FillProfile {
  const p = emptyProfile();
  p.personal.name = r.fullName;
  p.personal.email = r.email;
  p.personal.phone = r.phone;
  p.personal.address = r.address;
  p.personal.links = {
    linkedin: r.links.linkedin,
    github: r.links.github,
    portfolio: r.links.portfolio,
  };
  return p;
}

/** The value an ATS field of a given canonical target should receive, or "" when the resume lacks it. */
export function expectedValue(r: ResumeGroundTruth, target: ExpectedTarget): string {
  switch (target) {
    case "fullName":
      return r.fullName;
    case "firstName":
      return r.expectedFirst;
    case "lastName":
      return r.expectedLast;
    case "email":
      return r.email;
    case "phone":
      return r.phone;
    case "address":
      return r.address;
    case "linkedin":
      return r.expectedLinks.linkedin ?? "";
    case "github":
      return r.expectedLinks.github ?? "";
    case "portfolio":
      return r.expectedLinks.portfolio ?? "";
    case "skip":
      return "";
  }
}

export interface Miss {
  formId: string;
  target: ExpectedTarget;
  label: string;
  expected: string;
  got: string;
  gotStatus: string;
}

export interface ResumeScore {
  id: string;
  archetype: string;
  applicable: number;
  correct: number;
  percent: number;
  misses: Miss[];
  falsePositives: Miss[];
}

const norm = (s: string) => s.trim();

export function scoreResume(r: ResumeGroundTruth): ResumeScore {
  const profile = profileFromGroundTruth(r);
  let applicable = 0;
  let correct = 0;
  const misses: Miss[] = [];
  const falsePositives: Miss[] = [];

  for (const form of ATS_FORMS) {
    const descriptors = form.fields.map((field, i) => toDescriptor(field, i));
    const plan = buildFillPlan(descriptors, profile);
    form.fields.forEach((field, i) => {
      const item = plan[i]!;
      if (field.expects === "skip") {
        if (item.status === "fillable") {
          falsePositives.push({
            formId: form.id,
            target: field.expects,
            label: item.label,
            expected: "(should not fill)",
            got: item.value,
            gotStatus: item.status,
          });
        }
        return;
      }
      const want = expectedValue(r, field.expects);
      if (want === "") return; // resume has no data for this field — nothing to fill
      applicable++;
      if (item.status === "fillable" && norm(item.value) === norm(want)) {
        correct++;
      } else {
        misses.push({
          formId: form.id,
          target: field.expects,
          label: item.label,
          expected: want,
          got: item.value,
          gotStatus: item.status,
        });
      }
    });
  }

  const percent = applicable === 0 ? 100 : Math.round((correct / applicable) * 1000) / 10;
  return { id: r.id, archetype: r.archetype, applicable, correct, percent, misses, falsePositives };
}
