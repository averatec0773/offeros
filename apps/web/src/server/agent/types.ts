import type { Db } from "../db/client";

/**
 * The agent's tool contract.
 *
 * Everything the agent can do to the world goes through a tool, and every tool
 * answers the same three questions: what did you do, did it actually take, and
 * what should be written down about it. That uniformity is the point — a
 * policy (scripted today, LLM later) never has to know how a capability is
 * implemented, and no capability can quietly skip verification or the ledger.
 *
 * Two contract rules, both bought with real incidents:
 *
 *   1. `verify` is not optional. Acting is not succeeding: a value written to
 *      a control that rejects it, a handoff claimed for the wrong job, an
 *      artifact "generated" that never landed — each looked like success at
 *      the call site and lied to the user. A tool reports `ok` only when its
 *      own verify saw the result in the world it changed.
 *   2. Human gates live here, not in callers. A tool that would step past a
 *      gate the user owns refuses, whoever called it. (The run queue stepped
 *      through the submit gate precisely because that check sat in the loop
 *      instead of in the capability.)
 */

/** What a tool call did, in a shape a policy — or a person — can read. */
export interface ToolObservation<T = unknown> {
  ok: boolean;
  /** One line, present tense, written for the timeline: "tailored résumé v3". */
  summary: string;
  /** Structured result for a policy to branch on. Absent when `ok` is false. */
  result?: T;
  /** Why it did not work — a failure class a repair ladder can dispatch on. */
  failure?: ToolFailure;
}

export type ToolFailureKind =
  /** A precondition the caller could have checked (wrong state, missing input). */
  | "precondition"
  /** The task waits on a person and the tool refuses to act for them. */
  | "human-gate"
  /** The action ran but verification says the world did not change. */
  | "unverified"
  /** An external dependency (provider, network, filesystem) failed. */
  | "dependency"
  /** A budget (steps, tokens, wall clock) is exhausted. */
  | "budget";

export interface ToolFailure {
  kind: ToolFailureKind;
  reason: string;
}

export interface ToolContext {
  db: Db;
  /** The application every tool call is scoped to — the ledger's subject. */
  applicationId: string;
  taskId?: string;
  /** Set by the policy so the trace records WHY a tool ran, not just that it did. */
  reason?: string;
  /**
   * The user's latest message, VERBATIM, set by the harness (never by the
   * model). A tool whose gate is "the user said so" checks THIS — a
   * model-supplied flag asserts nothing, because the model writes its own
   * inputs.
   */
  latestUserMessage?: string;
}

export interface Tool<I = void, R = unknown> {
  id: string;
  /** One sentence: what it does and when a policy should reach for it. */
  description: string;
  /** Parse/validate the input. Throwing here is a precondition failure. */
  parse?: (input: unknown) => I;
  run: (ctx: ToolContext, input: I) => Promise<ToolObservation<R>>;
  /**
   * Independent confirmation that the world changed, read AFTER `run` from the
   * durable source (DB row, artifact, report) rather than from run's own
   * return value. A tool with nothing external to check returns null to say
   * "nothing to verify" — it must not return true to mean the same thing.
   */
  verify?: (ctx: ToolContext, input: I, result: unknown) => Promise<boolean | null>;
}

/** A single line of the machine-readable trace (the human timeline stays events). */
export interface TraceEntry {
  id: string;
  applicationId: string;
  taskId?: string;
  tool: string;
  /** Why the policy chose this tool — free text, shown in the console. */
  reason?: string;
  ok: boolean;
  summary: string;
  failureKind?: ToolFailureKind;
  failureReason?: string;
  /** Whether an independent verify ran, and what it said. */
  verified?: boolean;
  durationMs: number;
  at: number;
}
