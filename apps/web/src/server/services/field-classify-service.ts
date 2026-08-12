import {
  guardClassOf,
  isAutoAnswerForbidden,
  matchAnswer,
  personalValue,
  type FillProfile,
  type CanonicalField,
} from "@offeros/autofill";
import type { ClassifyFieldInput, FieldMapping } from "@offeros/llm";

/**
 * Turning a model's mapping into something the fill engine may execute.
 *
 * This is the half of the AI fallback classifier that is deliberately NOT a
 * model. The model said "this field is asking for the applicant's phone
 * number"; whether that produces a value, and which value, is decided here from
 * the profile the user owns. Three properties fall out of that split, and they
 * are the reason the split exists:
 *
 *   - the guards still run. A model that maps a field to work authorization
 *     does not get one filled in: `isAutoAnswerForbidden` is checked HERE, on
 *     the field's own label and options, and refuses regardless of what the
 *     mapping said. The model cannot talk its way past a guard because the
 *     guard never reads the model's output.
 *   - a hallucinated target is inert. A `canonical` target that is not a real
 *     canonical field, or an `answer` target matching nothing in the bank,
 *     resolves to nothing and the field stays unknown.
 *   - nothing the model wrote reaches the page. Values come from the profile
 *     and the answer bank; the model's prose is only ever a `reason` shown to
 *     the user.
 */

/** Every canonical field the deterministic engine can resolve to a value. */
export const CANONICAL_FIELDS: CanonicalField[] = [
  "fullName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "country",
  "postalCode",
  "linkedin",
  "github",
  "portfolio",
  "resume",
  "coverLetter",
  "skills",
  "recentCompany",
  "recentTitle",
];

/**
 * Canonical fields the fallback may map TO.
 *
 * `resume` and `coverLetter` are excluded on purpose: both are file uploads
 * handled by the attach path, and mapping a text field to them would produce an
 * empty value dressed up as a resolution. `skills` is excluded because it is a
 * multi-value tag field whose fill goes through a different driver — the
 * deterministic classifier already recognises it by label, and a fallback guess
 * at it would fill a plain text box with a comma-joined list.
 */
const FALLBACK_ELIGIBLE = new Set<CanonicalField>(
  CANONICAL_FIELDS.filter((f) => f !== "resume" && f !== "coverLetter" && f !== "skills"),
);

/** What one field ended up as, after the mapping met the profile and the guards. */
export interface FieldResolution {
  fieldId: string;
  /** `fillable` carries a value; `needs-answer` means generate or ask the user; `unknown` means we still do not know. */
  status: "fillable" | "needs-answer" | "unknown";
  value: string;
  /** Mirrors the engine's plan vocabulary so the panel can merge these straight in. */
  source: "personal" | "answerBank" | "generate" | "none";
  /** The model's own confidence, carried through for display. */
  confidence: number;
  /** Plain language, shown to the user. Always says the mapping came from AI. */
  reason: string;
  /** Set when a guard refused the mapping — the user answers this one themselves. */
  blockedBy?: "sensitive" | "truth";
  answerId?: string;
  /** Free-text question the panel may offer per-field generation for. */
  generatable?: boolean;
}

/** The fields worth sending: only ones the deterministic engine gave up on. */
export function eligibleForFallback(f: { currentStatus: string }): boolean {
  return f.currentStatus === "unknown";
}

/**
 * Resolve the model's mappings against the profile the user owns.
 *
 * `fields` is the same list that was sent for classification — needed here
 * because the guards read the field's own label and options, not the mapping.
 */
export function resolveMappings(
  mappings: FieldMapping[],
  fields: ClassifyFieldInput[],
  profile: FillProfile,
): FieldResolution[] {
  const fieldById = new Map(fields.map((f) => [f.fieldId, f]));
  const canonicalByName = new Map(CANONICAL_FIELDS.map((c) => [c.toLowerCase(), c]));

  const out: FieldResolution[] = [];
  for (const m of mappings) {
    const field = fieldById.get(m.fieldId);
    // A fieldId we never sent is not a field — the model invented it. Drop it
    // rather than letting it into a plan keyed by fieldId.
    if (!field) continue;

    const unknown = (reason: string): FieldResolution => ({
      fieldId: m.fieldId,
      status: "unknown",
      value: "",
      source: "none",
      confidence: m.confidence,
      reason,
    });

    // The guard runs before the mapping is even looked at. A field whose own
    // label or options make it a self-identification or work-authorization
    // question is the user's to answer, whatever the model decided it was.
    //
    // The model's own `guardHint` can ADD to this and never subtract from it.
    // The deterministic guards are English regexes; this task exists for forms
    // they cannot read, so the moment a German or Japanese form becomes
    // fillable an English-only guard is the weakest thing between a model and a
    // legal assertion on a real application. A model that recognises a
    // work-authorization question in a language the regex missed gets to stop
    // it — and a model that says an obviously guarded question is fine is
    // simply ignored, because `isAutoAnswerForbidden` is checked first and its
    // answer is never revisited.
    const subject = { label: field.label, options: field.options };
    const hinted = m.guardHint === "sensitive" || m.guardHint === "truth";
    if (isAutoAnswerForbidden(subject) || hinted) {
      const guard = guardClassOf(subject) ?? m.guardHint;
      out.push({
        fieldId: m.fieldId,
        status: "needs-answer",
        value: "",
        source: "none",
        confidence: m.confidence,
        blockedBy: guard === "sensitive" ? "sensitive" : "truth",
        reason:
          guard === "sensitive"
            ? "AI matched this field, but self-identification questions are yours to answer — set them once in Profile → Equal Employment."
            : "AI matched this field, but work-authorization questions are a legal statement only you can make.",
      });
      continue;
    }

    if (m.mapping === "cannot-map") {
      out.push(unknown(`AI couldn't tell what this field is asking for. ${m.reason}`.trim()));
      continue;
    }

    if (m.mapping === "generate") {
      out.push({
        fieldId: m.fieldId,
        status: "needs-answer",
        value: "",
        source: "generate",
        confidence: m.confidence,
        generatable: true,
        reason: `AI read this as an open-ended question. ${m.reason}`.trim(),
      });
      continue;
    }

    if (m.mapping === "canonical") {
      const canonical = canonicalByName.get((m.target ?? "").trim().toLowerCase());
      if (!canonical || !FALLBACK_ELIGIBLE.has(canonical)) {
        out.push(unknown("AI named a profile field that can't be filled this way."));
        continue;
      }
      const value = personalValue(canonical, profile);
      if (value.trim() === "") {
        out.push({
          fieldId: m.fieldId,
          status: "needs-answer",
          value: "",
          source: "personal",
          confidence: m.confidence,
          reason: `AI matched this to your ${canonical}, which is empty in your profile.`,
        });
        continue;
      }
      out.push({
        fieldId: m.fieldId,
        status: "fillable",
        value,
        source: "personal",
        confidence: m.confidence,
        reason: `AI matched this to your ${canonical}. ${m.reason}`.trim(),
      });
      continue;
    }

    // mapping === "answer": the target names a question the bank answers. The
    // bank is matched with the SAME matcher the deterministic path uses, so a
    // target that no longer matches anything resolves to nothing.
    const stored = matchAnswer(m.target ?? "", profile.answerBank);
    if (!stored || stored.answer.trim() === "") {
      out.push(unknown("AI matched this to a saved answer that no longer exists."));
      continue;
    }
    out.push({
      fieldId: m.fieldId,
      status: "fillable",
      value: stored.answer,
      source: "answerBank",
      answerId: stored.id,
      confidence: m.confidence,
      reason: `AI matched this to an answer you saved before. ${m.reason}`.trim(),
    });
  }
  return out;
}

/** The answer bank's questions, for the prompt. Questions only — never answers. */
export function answerQuestionsOf(profile: FillProfile): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of profile.answerBank) {
    for (const pattern of entry.questionPatterns) {
      const q = pattern.trim();
      if (q === "" || seen.has(q.toLowerCase())) continue;
      seen.add(q.toLowerCase());
      out.push(q);
    }
  }
  return out;
}
