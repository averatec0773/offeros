import type { AgentTask } from "@offeros/core";
import type { PipelineContext } from "../types";

/**
 * Shared no-op body for confirm gates (confirm-resume, confirm-cover-letter).
 * The gate itself stops the runner at `awaiting_user`; approving via
 * `advance()` just moves past without running a body — this exists only to
 * satisfy the `PipelineStep.run` contract.
 */
export async function run(_ctx: PipelineContext, _task: AgentTask): Promise<void> {}
