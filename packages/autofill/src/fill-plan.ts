import { classifyField, type CanonicalField, type FieldDescriptor } from "./classify";
import { splitName, normalizeLink } from "./format";
import { matchAnswer } from "./answer-match";
import { matchOption } from "./option-match";
import type { FillProfile } from "./types";

export type FillStatus = "fillable" | "needs-answer" | "unknown";

export interface FillItem {
  fieldId: string;
  label: string;
  status: FillStatus;
  value: string;
  source: "personal" | "answerBank" | "none" | "generate";
  required: boolean;
  answerId?: string;
  /** Multi-value payload for tag/typeahead fields (skills). Absent on scalar fields. */
  values?: string[];
  /** Open-ended free-text question — offer per-field LLM generation. */
  generatable?: boolean;
}

// A free-text box (textarea) or a long question-like label the classifier and
// answer bank both passed on — the case for a per-field LLM
// "generate" button rather than a stored value.
function isOpenEnded(desc: FieldDescriptor, label: string): boolean {
  if (desc.type === "textarea") return true;
  return label.trim().split(/\s+/).filter(Boolean).length > 6;
}

function personalValue(field: CanonicalField, profile: FillProfile): string {
  const p = profile.personal;
  switch (field) {
    case "fullName":
      return p.name;
    case "firstName":
      return splitName(p.name).first;
    case "lastName":
      return splitName(p.name).last;
    case "email":
      return p.email;
    case "phone":
      return p.phone;
    case "address":
      return p.address;
    case "city":
      return p.city ?? "";
    case "state":
      return p.state ?? "";
    case "country":
      return p.country ?? "";
    case "postalCode":
      return p.postalCode ?? "";
    case "linkedin":
      return normalizeLink(p.links.linkedin ?? "");
    case "github":
      return normalizeLink(p.links.github ?? "");
    case "portfolio":
      return normalizeLink(p.links.portfolio ?? "");
    case "resume":
      return ""; // manual upload in Plan 4
    case "coverLetter":
      return ""; // manual upload in Plan 4
    case "skills":
      return ""; // multi-value; carried on FillItem.values, not here
    case "recentCompany":
      return p.recentCompany ?? "";
    case "recentTitle":
      return p.recentTitle ?? "";
  }
}

export function buildFillPlan(
  descriptors: FieldDescriptor[],
  profile: FillProfile | null,
): FillItem[] {
  return descriptors.map((desc): FillItem => {
    const label = desc.label || desc.ariaLabel || desc.placeholder || desc.name;
    const required = desc.required === true;

    // any file input is manual — resume upload or otherwise; never a text fill target.
    if (desc.type === "file") {
      return {
        fieldId: desc.fieldId,
        label,
        status: "needs-answer",
        value: "",
        source: "personal",
        required,
      };
    }

    const canonical = classifyField(desc);

    if (canonical) {
      // resume asked via a non-file control (e.g. "link to resume") stays manual.
      if (canonical === "resume") {
        return {
          fieldId: desc.fieldId,
          label,
          status: "needs-answer",
          value: "",
          source: "personal",
          required,
        };
      }
      // skills is a multi-value tag/typeahead field — carry every resume skill
      // on `values` for the driver's per-skill fill loop.
      if (canonical === "skills") {
        const values = profile?.skills ?? [];
        return {
          fieldId: desc.fieldId,
          label,
          status: values.length > 0 ? "fillable" : "needs-answer",
          value: "",
          values,
          source: "personal",
          required,
        };
      }
      const value = profile ? personalValue(canonical, profile) : "";
      return {
        fieldId: desc.fieldId,
        label,
        status: value.trim() !== "" ? "fillable" : "needs-answer",
        value,
        source: "personal",
        required,
      };
    }

    // Choice groups (radio-group / checkbox-group): a stored answer counts
    // only if it actually maps onto one of the group's options — the value
    // carried is the OPTION's own label, so the driver can click it verbatim.
    if ((desc.type === "radio-group" || desc.type === "checkbox-group") && desc.options?.length) {
      const stored = profile
        ? matchAnswer(desc.label || desc.ariaLabel || "", profile.answerBank)
        : null;
      const option = stored
        ? matchOption(
            desc.options.map((o) => ({ label: o, value: o })),
            stored.answer,
          )
        : null;
      if (stored && option) {
        return {
          fieldId: desc.fieldId,
          label,
          status: "fillable",
          value: String(option.label ?? ""),
          source: "answerBank",
          required,
          answerId: stored.id,
        };
      }
      return {
        fieldId: desc.fieldId,
        label,
        status: "needs-answer",
        value: "",
        source: "none",
        required,
      };
    }

    const match = profile
      ? matchAnswer(desc.label || desc.ariaLabel || "", profile.answerBank)
      : null;
    if (match) {
      return {
        fieldId: desc.fieldId,
        label,
        status: match.answer.trim() !== "" ? "fillable" : "needs-answer",
        value: match.answer,
        source: "answerBank",
        required,
        answerId: match.id,
      };
    }

    if (isOpenEnded(desc, label)) {
      return {
        fieldId: desc.fieldId,
        label,
        status: "needs-answer",
        value: "",
        source: "generate",
        required,
        generatable: true,
      };
    }

    return { fieldId: desc.fieldId, label, status: "unknown", value: "", source: "none", required };
  });
}

export type FieldTrace = {
  fieldId: string;
  label: string;
  classifiedType: CanonicalField | "unknown";
  status: FillStatus;
  chosenValue: string;
  source: FillItem["source"];
  /** Human-readable: WHY this field got this decision. */
  reason: string;
};

// Where a canonical field's value comes from on the profile, for the reason string.
function personalSourcePath(field: CanonicalField): string {
  switch (field) {
    case "fullName":
      return "profile.personal.name";
    case "firstName":
      return "profile.personal.name (first)";
    case "lastName":
      return "profile.personal.name (last)";
    case "email":
      return "profile.personal.email";
    case "phone":
      return "profile.personal.phone";
    case "address":
      return "profile.personal.address";
    case "city":
      return "profile.personal.city";
    case "state":
      return "profile.personal.state";
    case "country":
      return "profile.personal.country";
    case "postalCode":
      return "profile.personal.postalCode";
    case "linkedin":
      return "profile.personal.links.linkedin";
    case "github":
      return "profile.personal.links.github";
    case "portfolio":
      return "profile.personal.links.portfolio";
    case "resume":
      return "profile (manual upload)";
    case "coverLetter":
      return "profile (manual upload)";
    case "skills":
      return "profile.skills";
    case "recentCompany":
      return "profile.experience[0].company";
    case "recentTitle":
      return "profile.experience[0].title";
  }
}

// Re-derives WHY buildFillPlan's item looks the way it does. Mirrors buildFillPlan's
// branch order but only classifies (never recomputes a value) — the value always
// comes from the already-built FillItem.
function deriveReason(
  desc: FieldDescriptor,
  item: FillItem,
  canonical: CanonicalField | null,
  profile: FillProfile | null,
): string {
  if (desc.type === "file") {
    const suffix = canonical ? ` (classified '${canonical}')` : "";
    return `file input${suffix} → always manual upload, left needs-answer`;
  }

  if (canonical) {
    if (canonical === "resume") {
      return `classified 'resume' via non-file control → manual upload, left needs-answer`;
    }
    if (canonical === "skills") {
      const n = item.values?.length ?? 0;
      return n > 0
        ? `classified 'skills' → carried ${n} profile skill${n === 1 ? "" : "s"} as tag values`
        : `classified 'skills' but profile has no skills → needs-answer`;
    }
    return item.status === "fillable"
      ? `classified '${canonical}' → filled from ${personalSourcePath(canonical)}`
      : `classified '${canonical}' but ${profile ? "profile field empty" : "no profile loaded"} → needs-answer`;
  }

  if (item.source === "answerBank") {
    return item.status === "fillable"
      ? `answer-bank pattern matched label "${item.label}" → filled`
      : `answer-bank pattern matched label "${item.label}" but stored answer is empty → needs-answer`;
  }

  if (item.generatable) {
    return `no classifier or answer-bank match, open-ended question → offered for per-field generation`;
  }

  return `no classifier match → left unknown`;
}

/**
 * Wraps buildFillPlan with a per-field decision trace — WHY each field got its
 * value, for the dev agent / eval harness to inspect. Purely additive: the
 * `plan` is exactly buildFillPlan's output, unchanged.
 */
export function explainFillPlan(
  descriptors: FieldDescriptor[],
  profile: FillProfile | null,
): { plan: FillItem[]; trace: FieldTrace[] } {
  const plan = buildFillPlan(descriptors, profile);
  const trace = descriptors.map((desc, i): FieldTrace => {
    const item = plan[i]!;
    const canonical = classifyField(desc);
    const chosenValue = item.values && item.values.length > 0 ? item.values.join(", ") : item.value;
    return {
      fieldId: item.fieldId,
      label: item.label,
      classifiedType: canonical ?? "unknown",
      status: item.status,
      chosenValue,
      source: item.source,
      reason: deriveReason(desc, item, canonical, profile),
    };
  });
  return { plan, trace };
}

/** Share of scanned fields the engine recognized (canonical or answer-bank match). */
export function classifiedRatio(plan: FillItem[]): number {
  if (plan.length === 0) return 1;
  return plan.filter((i) => i.source !== "none").length / plan.length;
}

export interface Coverage {
  filled: number;
  total: number;
  percent: number;
  /** True when the metric counts required fields; false when it falls back to all fields. */
  requiredBasis: boolean;
}

/**
 * Submit-readiness for the checklist header. Counts required fields we have a
 * value for over all required fields; when the ATS marks nothing required, falls
 * back to all fields so the bar still means something. A field is "filled" here
 * when it is fillable (we have a value ready) — the green check.
 */
export function fillCoverage(plan: FillItem[]): Coverage {
  const isFilled = (i: FillItem) => i.status === "fillable";
  const required = plan.filter((i) => i.required);
  const basis = required.length > 0 ? required : plan;
  const total = basis.length;
  const filled = basis.filter(isFilled).length;
  const percent = total === 0 ? 100 : Math.round((filled / total) * 100);
  return { filled, total, percent, requiredBasis: required.length > 0 };
}
