import type { AgentTask, AgentTaskStatus, PipelineStepKey } from "@offeros/core";
import type { Db } from "../db/client";
import type { PipelineRepos } from "./context";

/** A confirm gate is Approve/Tweak; a choice gate is Skip/Generate. */
export type GateKind = "confirm" | "choice";

/**
 * Forward-looking result shape a step's real body (Task 5) may report. The
 * runner in 2b drives state itself, so registered steps return `void`; this
 * type is the contract Task 5 can adopt when steps start surfacing status/notes.
 */
export interface StepResult {
  status?: AgentTaskStatus;
  note?: string;
}

export interface PipelineStep {
  key: PipelineStepKey;
  /**
   * How reaching this step stops for the user, if at all. May depend on the
   * task (e.g. a `required` cover letter runs with no stop, while an `optional`
   * one presents a Skip/Generate choice). Absent/`undefined` → the step just runs.
   */
  gate?: GateKind | ((task: AgentTask) => GateKind | undefined);
  /** False → the runner skips this step entirely (gate included). */
  shouldRun(ctx: PipelineContext, task: AgentTask): boolean | Promise<boolean>;
  /** Produces the step's artifact(s). No HTTP/SQL — use ctx.repos / ctx.runLlm. */
  run(ctx: PipelineContext, task: AgentTask): Promise<void>;
}

/** Resolve a step's gate for a given task (static value or task-dependent fn). */
export function resolveGate(step: PipelineStep, task: AgentTask): GateKind | undefined {
  return typeof step.gate === "function" ? step.gate(task) : step.gate;
}

/**
 * Everything a step (or the runner) needs, with all IO injected: repositories
 * bound to a single `db`, and an LLM entry point wired to server-side settings.
 */
export interface PipelineContext {
  db: Db;
  taskId: string;
  runLlm(taskId: string, input: unknown): Promise<unknown>;
  repos: PipelineRepos;
  /** The step registry to advance through (defaults to the real STEPS). */
  steps: PipelineStep[];
}
