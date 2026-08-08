import { PIPELINE_STEPS } from "@offeros/core";
import { getAgentTask } from "../repositories/agent-task-repo";
import { getArtifact } from "../repositories/artifact-repo";
import { getApplication } from "../repositories/application-repo";
import { getFit } from "../repositories/fit-repo";
import { runTargetedStep } from "../pipeline/runner";
import { buildPipelineContext } from "../pipeline/route-context";
import { computeFit } from "../services/fit-service";
import { createHandoffForTask, completeSubmitted } from "../services/fill-service";
import type { Tool, ToolContext, ToolObservation } from "./types";

/**
 * The capability set, expressed as tools.
 *
 * Each one wraps a service that already exists — the value added here is the
 * uniform shape (a policy branches on observations, not on exception types),
 * the verification that reads the durable record afterwards, and the human
 * gates enforced at this layer so no caller can route around them.
 */

const HUMAN_GATES = new Set(["fill-form", "submit"]);

function stepKeyOf(db: ToolContext["db"], taskId: string): string | undefined {
  const task = getAgentTask(db, taskId);
  if (!task || task.status !== "awaiting_user") return undefined;
  return PIPELINE_STEPS[task.step]?.key;
}

function requireTaskId(ctx: ToolContext): string {
  if (!ctx.taskId) throw new Error("this tool needs a task");
  return ctx.taskId;
}

const gateRefusal = (where: string): ToolObservation => ({
  ok: false,
  summary: `waiting for you at ${where}`,
  failure: { kind: "human-gate", reason: `the task is parked at the ${where} gate` },
});

/** Tailor the résumé for this job (an out-of-band pipeline step run). */
export const tailorResumeTool: Tool<void, { version: number }> = {
  id: "tailor_resume",
  description:
    "Generate a tailored résumé for this application's job. Use when the task has no résumé artifact yet or the user asked for a fresh one.",
  run: async (ctx) => {
    const taskId = requireTaskId(ctx);
    await runTargetedStep(buildPipelineContext(taskId), "tailor-resume");
    const artifact = getArtifact(ctx.db, taskId, "resume");
    return artifact
      ? {
          ok: true,
          summary: `tailored résumé (${artifact.versions.length} version${artifact.versions.length === 1 ? "" : "s"})`,
          result: { version: artifact.versions.length },
        }
      : {
          ok: false,
          summary: "tailoring produced no résumé",
          failure: { kind: "unverified", reason: "no resume artifact after the step" },
        };
  },
  // The artifact row is the durable record — read it back rather than trusting
  // the step's own return.
  verify: async (ctx) => getArtifact(ctx.db, requireTaskId(ctx), "resume") !== null,
};

/** Write a cover letter for this job. */
export const coverLetterTool: Tool<void, { version: number }> = {
  id: "generate_cover_letter",
  description:
    "Generate a cover letter grounded in this job's description and the user's résumé. Use when the job asks for one.",
  run: async (ctx) => {
    const taskId = requireTaskId(ctx);
    await runTargetedStep(buildPipelineContext(taskId), "generate-cover-letter");
    const artifact = getArtifact(ctx.db, taskId, "cover-letter");
    return artifact
      ? {
          ok: true,
          summary: `wrote cover letter (${artifact.versions.length} version${artifact.versions.length === 1 ? "" : "s"})`,
          result: { version: artifact.versions.length },
        }
      : {
          ok: false,
          summary: "no cover letter was produced",
          failure: { kind: "unverified", reason: "no cover-letter artifact after the step" },
        };
  },
  verify: async (ctx) => getArtifact(ctx.db, requireTaskId(ctx), "cover-letter") !== null,
};

/** Score this application against the job (advisory, never a gate). */
export const computeFitTool: Tool<void, { overall: number }> = {
  id: "compute_fit",
  description:
    "Score how well the user fits this job and list the gaps. Advisory: it never blocks an application, it informs whether to spend effort on one.",
  run: async (ctx) => {
    // The fit task is application-scoped; the pipeline context supplies the
    // provider wiring whether or not an agent task exists yet.
    const runLlm = buildPipelineContext(ctx.taskId ?? ctx.applicationId).runLlm;
    const fit = await computeFit(ctx.db, ctx.applicationId, { runLlm });
    return { ok: true, summary: `fit ${fit.overall}%`, result: { overall: fit.overall } };
  },
  verify: async (ctx) => getFit(ctx.db, ctx.applicationId) !== null,
};

/** Open a fill ticket so the browser arm can take over. */
export const openFillTool: Tool<void, { handoffId: string }> = {
  id: "open_fill",
  description:
    "Create a fill ticket for the extension. Use when artifacts are ready and the form itself is the next thing that has to happen.",
  run: async (ctx) => {
    const taskId = requireTaskId(ctx);
    const handoff = createHandoffForTask(ctx.db, taskId);
    return { ok: true, summary: "opened a fill ticket", result: { handoffId: handoff.id } };
  },
  // Nothing further to confirm: createHandoffForTask already wrote the row and
  // returned it. Saying so explicitly (null) keeps "unverifiable" distinct
  // from "verified".
  verify: async () => null,
};

/**
 * Close the application as submitted. The gate check lives HERE: this is the
 * one action a person owns, and putting the check in the tool is what stops a
 * queue, a route, or a future policy from performing it on their behalf.
 */
export const markSubmittedTool: Tool<{ confirmedByUser: boolean }, { taskId: string }> = {
  id: "mark_submitted",
  description:
    "Record that the user submitted this application. Only ever call this with an explicit confirmation from the user — it closes the application.",
  parse: (input) => {
    const confirmed = (input as { confirmedByUser?: unknown } | null)?.confirmedByUser;
    if (confirmed !== true) throw new Error("confirmedByUser must be true");
    return { confirmedByUser: true };
  },
  run: async (ctx) => {
    const taskId = requireTaskId(ctx);
    const task = completeSubmitted(ctx.db, taskId);
    return { ok: true, summary: "marked as submitted", result: { taskId: task.id } };
  },
  verify: async (ctx) => getApplication(ctx.db, ctx.applicationId)?.status === "applied",
};

/**
 * The gate reporter: what the task is waiting on, if anything. A policy calls
 * this before deciding, so "the human has it" is an observation rather than a
 * failure it stumbles into.
 */
export const checkGateTool: Tool<void, { gate: string | null }> = {
  id: "check_gate",
  description:
    "Report whether this task is parked at a gate a human owns (the form, or submission). Call before choosing any acting tool.",
  run: async (ctx) => {
    const key = stepKeyOf(ctx.db, requireTaskId(ctx));
    const gate = key && HUMAN_GATES.has(key) ? key : null;
    return {
      ok: true,
      summary: gate ? `waiting for you at ${gate}` : "no human gate",
      result: { gate },
    };
  },
  verify: async () => null,
};

/** Every tool a policy may reach for, by id. */
export const TOOLS = {
  [checkGateTool.id]: checkGateTool,
  [tailorResumeTool.id]: tailorResumeTool,
  [coverLetterTool.id]: coverLetterTool,
  [computeFitTool.id]: computeFitTool,
  [openFillTool.id]: openFillTool,
  [markSubmittedTool.id]: markSubmittedTool,
} as const;

export { gateRefusal };
