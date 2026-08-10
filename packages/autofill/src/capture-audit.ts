import type { FieldDescriptor } from "./classify";
import { diffReplays, replayForm, type ReplayDivergence } from "./replay";
import type { FillProfile } from "./types";

/**
 * Is a captured form good enough to learn from?
 *
 * The replay lab's conclusions are only as sound as its inputs: a capture that
 * silently dropped a select's options, or lost the label that a guard matches
 * on, produces replays that "pass" against a form that never existed. Nobody
 * notices, because a broken capture does not look broken — it looks like a
 * simpler form. So captures are audited at the door and refused loudly, not
 * accepted quietly.
 *
 * Two independent checks, because they catch different failure shapes:
 *
 *  1. STRUCTURAL (`auditCapturedForm`) — invariants a real scan always
 *     satisfies. A violation means the capture tool lost information the live
 *     page had; no replay of such a fixture means anything. This is the check
 *     that carries the fidelity burden for anything lost IN THE PAGE, because
 *     no offline tool can see what a serializer dropped before it serialized —
 *     it can only notice the wreckage (a select with no options, a question
 *     with no text).
 *  2. ROUND-TRIP (`verifyCaptureRoundTrip`) — serialize → parse → replay must
 *     plan exactly what the input descriptors plan, for the same profile.
 *     Honest scope: by the time the capture tool runs, the input has usually
 *     been through JSON once already, so for today's string-and-array
 *     descriptors this mostly re-proves JSON's idempotence. It exists as a
 *     REGRESSION TRIPWIRE for the descriptor shape itself — the day someone
 *     adds a field that JSON cannot carry (a Map, a getter, an undefined that
 *     matters), every capture starts failing loudly here instead of replaying
 *     quietly wrong. Deliberately not a stored plan-snapshot: those go stale
 *     the moment the classifier improves, and a gate that cries wolf on every
 *     engine improvement gets deleted.
 *
 * The strongest fidelity guarantee is upstream of both: capture from the
 * engine's own scan (the SCAN message returns exactly what live fills plan
 * on, already across the same messaging boundary), not from an ad-hoc
 * serializer walking the DOM by hand.
 */

export interface CaptureFinding {
  severity: "error" | "warning";
  fieldId: string;
  message: string;
}

/** Control types whose meaning IS their option list: capturing one without
 *  options is capturing a question with its answers torn off. */
const NEEDS_OPTIONS = new Set(["select", "radio-group", "checkbox-group"]);

export function auditCapturedForm(fields: FieldDescriptor[]): CaptureFinding[] {
  const findings: CaptureFinding[] = [];
  if (fields.length === 0) {
    return [{ severity: "error", fieldId: "", message: "capture has no fields at all" }];
  }

  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.fieldId)) {
      findings.push({
        severity: "error",
        fieldId: field.fieldId,
        message: "duplicate fieldId — two controls captured under one identity",
      });
    }
    seen.add(field.fieldId);

    if (NEEDS_OPTIONS.has(field.type) && (!field.options || field.options.length === 0)) {
      findings.push({
        severity: "error",
        fieldId: field.fieldId,
        message: `"${field.type}" captured without its options — the choices were lost`,
      });
    }

    // A field with no textual identity at all cannot be classified, matched
    // against the answer bank, or — the dangerous part — GUARDED: the
    // sensitive-question guards match on text, so a lost label can turn a
    // work-authorisation question into an unguarded free-for-all. Warning,
    // not error, because some real pages genuinely have such controls.
    if (!field.label && !field.ariaLabel && !field.name && !field.placeholder) {
      findings.push({
        severity: "warning",
        fieldId: field.fieldId,
        message: "no label, aria-label, name or placeholder — unclassifiable and unguardable",
      });
    }
  }
  return findings;
}

/**
 * The round-trip gate: JSON-serialize the descriptors the way a capture file
 * does, parse them back, and replay both sides with the same profile. Any
 * divergence means the serialization loses something the engine acts on.
 */
export function verifyCaptureRoundTrip(
  fields: FieldDescriptor[],
  profile: FillProfile,
): ReplayDivergence[] {
  const roundTripped = JSON.parse(JSON.stringify(fields)) as FieldDescriptor[];
  try {
    return diffReplays(replayForm(fields, profile), replayForm(roundTripped, profile));
  } catch (error) {
    // The round-tripped form does not even replay — descriptors carried state
    // JSON cannot (getters, prototypes, undefineds-become-missing). That is
    // the strongest possible divergence, and a GATE must report it as one:
    // a verifier that crashes instead of failing gets wrapped in a try/catch
    // by its caller and silently stops verifying.
    return [
      {
        fieldId: "",
        what: "missing-field",
        a: "original form replays",
        b: `round-tripped form crashed the engine: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }
}
