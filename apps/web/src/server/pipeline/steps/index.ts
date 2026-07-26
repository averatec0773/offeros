import { PIPELINE_STEPS, type PipelineStepKey } from "@offeros/core";
import type { PipelineStep } from "../types";
import { run as tailorResumeRun } from "./tailor-resume";
import { run as analyzeSiteRun } from "./analyze-site";
import { run as generateCoverLetterRun } from "./generate-cover-letter";
import { run as confirmRun } from "./confirm";

/**
 * Which milestone stops for the user, and how. Reaching a `confirm` step means
 * Approve/Tweak; a `choice` step means Skip/Generate. Absent → the step just
 * runs. Data-driven so adding a gate is an entry, not a branch.
 */
/**
 * Gate per step. `generate-cover-letter` is gate-as-function: an **optional** (or
 * as-yet-**unknown**) cover letter presents a Skip/Generate choice; a **required**
 * one runs with no stop (auto-generate); `none` is already handled by `shouldRun`
 * (skipped). We treat `unknown` like `optional` so the user is asked rather than
 * having a letter generated on an undetermined requirement.
 */
const GATES: Partial<Record<PipelineStepKey, PipelineStep["gate"]>> = {
  "confirm-resume": "confirm",
  "generate-cover-letter": (task) =>
    task.coverLetterRequirement === "optional" || task.coverLetterRequirement === "unknown"
      ? "choice"
      : undefined,
  "confirm-cover-letter": "confirm",
};

/** Steps that only apply when a cover letter is actually wanted. */
const COVER_LETTER_STEPS = new Set<PipelineStepKey>([
  "generate-cover-letter",
  "confirm-cover-letter",
]);

/** Real `run` bodies, keyed by step. `fill-form` / `submit` are never
 *  executed — the runner stops at `fill-form` (the 2c boundary) — so they
 *  fall back to a no-op. */
const RUNS: Partial<Record<PipelineStepKey, PipelineStep["run"]>> = {
  "tailor-resume": tailorResumeRun,
  "confirm-resume": confirmRun,
  "analyze-site": analyzeSiteRun,
  "generate-cover-letter": generateCoverLetterRun,
  "confirm-cover-letter": confirmRun,
};

/**
 * The step registry: one entry per `PIPELINE_STEPS` key, in order.
 * `shouldRun` carries the only real branching (cover-letter conditionality)
 * the runner needs to exercise.
 */
export const STEPS: PipelineStep[] = PIPELINE_STEPS.map(({ key }) => ({
  key,
  gate: GATES[key],
  shouldRun: (_ctx, task) =>
    COVER_LETTER_STEPS.has(key)
      ? task.coverLetterRequirement !== "none" && !task.skippedCoverLetter
      : true,
  run: RUNS[key] ?? (async () => {}),
}));
