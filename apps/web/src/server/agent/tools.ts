import { PIPELINE_STEPS } from "@offeros/core";
import { getPipelineTask } from "../repositories/pipeline-task-repo";
import { getArtifact } from "../repositories/artifact-repo";
import { getApplication } from "../repositories/application-repo";
import { getFit } from "../repositories/fit-repo";
import { runTargetedStep } from "../pipeline/runner";
import { buildPipelineContext } from "../pipeline/route-context";
import { computeFit } from "../services/fit-service";
import {
  createHandoffForTask,
  completeSubmitted,
  buildQuestionContext,
} from "../services/fill-service";
import { tweakArtifact } from "../pipeline/tweak";
import { isAutoAnswerForbidden } from "@offeros/autofill";
import type { QuestionAnswerOutput } from "@offeros/llm";
import type { Tool, ToolContext, ToolObservation } from "./types";

/**
 * The capability set, expressed as tools.
 *
 * Each one wraps a service that already exists — the value added here is the
 * uniform shape (a policy branches on observations, not on exception types),
 * the verification that reads the durable record afterwards, and the human
 * gates enforced at this layer so no caller can route around them.
 *
 * LIVE IN PRODUCTION: `loop.ts` includes this registry in `runTurn`'s default
 * tool set, and the agent chat route calls `runTurn` without overriding it —
 * so every tool here is reachable from a chat message. Gates in this file are
 * therefore real security boundaries, not future-proofing. (An earlier
 * version of this comment claimed the registry was unwired; a code review
 * caught that as stale — trust the imports, not this prose.)
 */

const HUMAN_GATES = new Set(["fill-form", "submit"]);

function stepKeyOf(db: ToolContext["db"], taskId: string): string | undefined {
  const task = getPipelineTask(db, taskId);
  if (!task || task.status !== "awaiting_user") return undefined;
  return PIPELINE_STEPS[task.step]?.key;
}

function requireTaskId(ctx: ToolContext): string {
  if (!ctx.taskId) throw new Error("this tool needs a task");
  return ctx.taskId;
}

/** What a generation step produced, and what was there before it ran. */
interface ArtifactRun {
  versionsBefore: number;
  versionsAfter: number;
  currentVersionId: string | null;
}

/**
 * Run a generation step and describe what changed. The BEFORE snapshot is the
 * point: a step that quietly no-ops on a task that already has an artifact
 * would otherwise report a verified success for work it never did.
 */
async function runArtifactStep(
  ctx: ToolContext,
  step: "tailor-resume" | "generate-cover-letter",
  kind: "resume" | "cover-letter",
  noun: string,
): Promise<ToolObservation<ArtifactRun>> {
  const taskId = requireTaskId(ctx);
  const before = getArtifact(ctx.db, taskId, kind);
  const versionsBefore = before?.versions.length ?? 0;
  await runTargetedStep(buildPipelineContext(taskId), step);
  const after = getArtifact(ctx.db, taskId, kind);
  const versionsAfter = after?.versions.length ?? 0;
  if (!after || versionsAfter <= versionsBefore) {
    return {
      ok: false,
      summary: `no new ${noun} was produced`,
      result: {
        versionsBefore,
        versionsAfter,
        currentVersionId: after?.currentVersionId ?? null,
      },
      failure: {
        kind: "unverified",
        reason: after ? "the step added no version" : `no ${kind} artifact after the step`,
      },
    };
  }
  return {
    ok: true,
    summary: `${noun} v${versionsAfter}`,
    result: { versionsBefore, versionsAfter, currentVersionId: after.currentVersionId },
  };
}

/** Confirm from the durable record that a NEW version exists — not merely that
 *  some artifact does, which is what `run` already knew. */
const verifyArtifactAdvanced =
  (kind: "resume" | "cover-letter") =>
  async (ctx: ToolContext, _input: void, result: unknown): Promise<boolean> => {
    const run = result as ArtifactRun | undefined;
    const artifact = getArtifact(ctx.db, requireTaskId(ctx), kind);
    if (!artifact || !run) return false;
    return artifact.versions.length > run.versionsBefore;
  };

const gateRefusal = (where: string): ToolObservation => ({
  ok: false,
  summary: `waiting for you at ${where}`,
  failure: { kind: "human-gate", reason: `the task is parked at the ${where} gate` },
});

/** Tailor the résumé for this job (an out-of-band pipeline step run). */
export const tailorResumeTool: Tool<void, ArtifactRun> = {
  id: "tailor_resume",
  description:
    "Generate a tailored résumé for this application's job. Use when the task has no résumé artifact yet or the user asked for a fresh one.",
  run: async (ctx) => runArtifactStep(ctx, "tailor-resume", "resume", "tailored résumé"),
  verify: verifyArtifactAdvanced("resume"),
};

/** Write a cover letter for this job. */
export const coverLetterTool: Tool<void, ArtifactRun> = {
  id: "generate_cover_letter",
  description:
    "Generate a cover letter grounded in this job's description and the user's résumé. Use when the job asks for one.",
  run: async (ctx) => runArtifactStep(ctx, "generate-cover-letter", "cover-letter", "cover letter"),
  verify: verifyArtifactAdvanced("cover-letter"),
};

/** Revise the tailored résumé or cover letter from a plain-language
 *  instruction ("make it shorter", "lead with the ML work"). Wraps the same
 *  tweak the workspace uses; the new version is read back with read_artifact. */
export const refineArtifactTool: Tool<
  { kind: "resume" | "cover-letter"; instruction: string },
  ArtifactRun & { kind: string }
> = {
  id: "refine_artifact",
  description:
    'Revise the already-generated tailored résumé or cover letter from a plain-language instruction ("make it shorter", "emphasise the distributed-systems work", "warmer tone"). Input {"kind":"resume"|"cover-letter","instruction":"..."}. Produces a NEW version; call read_artifact afterwards to show the result. Use for "change/rewrite/improve the résumé/letter" — not for a first draft (use tailor_resume / generate_cover_letter for that).',
  parse: (input) => {
    const kind = (input as { kind?: unknown } | null)?.kind;
    const instruction = (input as { instruction?: unknown } | null)?.instruction;
    if (kind !== "resume" && kind !== "cover-letter") {
      throw new Error('kind must be "resume" or "cover-letter"');
    }
    if (typeof instruction !== "string" || instruction.trim() === "") {
      throw new Error("instruction is required");
    }
    return { kind, instruction: instruction.trim() };
  },
  run: async (ctx, input) => {
    const taskId = requireTaskId(ctx);
    const noun = input.kind === "resume" ? "tailored résumé" : "cover letter";
    const before = getArtifact(ctx.db, taskId, input.kind);
    if (!before) {
      return {
        ok: false,
        summary: `there is no ${noun} to revise yet`,
        failure: {
          kind: "precondition",
          reason: `no ${input.kind} artifact — generate one first with ${input.kind === "resume" ? "tailor_resume" : "generate_cover_letter"}`,
        },
      };
    }
    const versionsBefore = before.versions.length;
    await tweakArtifact(buildPipelineContext(taskId), input.kind, input.instruction);
    const after = getArtifact(ctx.db, taskId, input.kind);
    const versionsAfter = after?.versions.length ?? 0;
    if (!after || versionsAfter <= versionsBefore) {
      return {
        ok: false,
        summary: `the ${noun} was not revised`,
        result: {
          kind: input.kind,
          versionsBefore,
          versionsAfter,
          currentVersionId: after?.currentVersionId ?? null,
        },
        failure: { kind: "unverified", reason: "no new version was added" },
      };
    }
    return {
      ok: true,
      summary: `${noun} revised → v${versionsAfter}`,
      result: {
        kind: input.kind,
        versionsBefore,
        versionsAfter,
        currentVersionId: after.currentVersionId,
      },
    };
  },
  // The durable check: a NEW version exists beyond what was there before.
  verify: async (ctx, input, result) => {
    const run = result as (ArtifactRun & { kind: string }) | undefined;
    if (!run) return false;
    const artifact = getArtifact(ctx.db, requireTaskId(ctx), input.kind);
    return !!artifact && artifact.versions.length > run.versionsBefore;
  },
};

/**
 * Draft a grounded answer to an application question the user has not answered
 * yet — so "what do I put here?" becomes a real proposed answer instead of a
 * shrug. It DRAFTS, it does not save: the agent shows the draft; the user then
 * says "save it" and save_answer records it. Refuses the questions the fill
 * engine's own guards refuse to auto-answer (identity/demographics, and the
 * legally-consequential truth questions — work authorization, sponsorship,
 * citizenship): a drafted answer to those would be putting words in the user's
 * mouth on something only they can answer.
 */
export const draftAnswerTool: Tool<{ question: string; options?: string[] }, { draft: string }> = {
  id: "draft_answer",
  description:
    'Draft a grounded, first-person answer to an application question the user has not answered — for "what should I write for this?" / "draft an answer for the … question". Input {"question":"...","options":["..."]} (options only for multiple-choice). It grounds the draft in the job\'s JD and the user\'s résumé/profile. Show the draft and offer to save it with save_answer — it does NOT save on its own. It refuses identity/demographic and work-authorization/sponsorship/citizenship questions: those are the user\'s to answer.',
  parse: (input) => {
    const o = (input ?? {}) as Record<string, unknown>;
    const question = o.question;
    if (typeof question !== "string" || question.trim() === "") {
      throw new Error("question is required");
    }
    const options = Array.isArray(o.options)
      ? o.options.filter((x): x is string => typeof x === "string" && x.trim() !== "")
      : undefined;
    return { question: question.trim(), ...(options && options.length ? { options } : {}) };
  },
  run: async (ctx, input) => {
    const taskId = requireTaskId(ctx);
    // Same guard the panel's AI-answer flow uses: some questions must never be
    // answered on the user's behalf, drafted or not.
    if (isAutoAnswerForbidden({ label: input.question, options: input.options })) {
      return {
        ok: false,
        summary: "this question is the user's to answer, not mine to draft",
        failure: {
          kind: "human-gate",
          reason:
            "identity/demographic or work-authorization/sponsorship/citizenship questions are never auto-answered — ask the user for their answer and offer to save it with save_answer",
        },
      };
    }
    const grounding = buildQuestionContext(ctx.db, taskId);
    const output = (await buildPipelineContext(taskId).runLlm("question-answer", {
      question: input.question,
      label: input.question,
      ...(input.options ? { options: input.options } : {}),
      profileSummary: grounding.profileSummary,
      jdText: grounding.jdText,
      resumeText: grounding.resumeText,
    })) as QuestionAnswerOutput;
    const draft = output.answer.trim();
    if (!draft) {
      return {
        ok: false,
        summary: "could not draft an answer",
        failure: { kind: "dependency", reason: "the model returned an empty draft" },
      };
    }
    return { ok: true, summary: `drafted an answer (${draft.length} chars)`, result: { draft } };
  },
  // Nothing durable changed — a draft is not saved. Null keeps "unverifiable"
  // honest, distinct from a verified write.
  verify: async () => null,
};

/** Score this application against the job (advisory, never a gate). */
export const computeFitTool: Tool<
  void,
  { overall: number; label: string; whyMatch?: string; gaps?: string[] }
> = {
  id: "compute_fit",
  description:
    "Score how well the user fits this job AND list the gaps (missing/weak skills) and why it's a match. Advisory: it never blocks an application, it informs whether to spend effort on one.",
  run: async (ctx) => {
    // The fit task is application-scoped; the pipeline context supplies the
    // provider wiring whether or not an agent task exists yet.
    const runLlm = buildPipelineContext(ctx.taskId ?? ctx.applicationId).runLlm;
    const fit = await computeFit(ctx.db, ctx.applicationId, { runLlm });
    const gaps = fit.notAlignedSkills.slice(0, 12).map((g) => g.skill);
    return {
      ok: true,
      summary: `fit ${fit.overall}%${gaps.length ? ` · ${gaps.length} gap(s)` : ""}`,
      result: {
        overall: fit.overall,
        label: fit.label,
        ...(fit.whyMatch ? { whyMatch: fit.whyMatch } : {}),
        ...(gaps.length ? { gaps } : {}),
      },
    };
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
 * Does the user's own message actually claim they submitted (or instruct us to
 * mark it so)? Checked against ctx.latestUserMessage — text the harness took
 * from the request, which the model cannot write. Deliberately conservative:
 * a miss costs one clarifying question ("please say you submitted it"), while
 * a loose match would let scraped page text nudge the model through the gate.
 */
const SUBMISSION_CLAIMS: RegExp[] = [
  /\bsubmitted\b/i, // "I submitted it", "just submitted"
  /\bi(?:'ve| have)? (?:just )?applied\b/i, // "I applied" — not "should I apply"
  /\bmark (?:it|this|that)? ?(?:as )?(?:submitted|applied)\b/i, // explicit instruction
  /(?:提交|投递|投)(?:了|完|好了)/, // completed-action particle: "提交了" not "要提交"
  /已(?:提交|投递|申请)/,
];

function userClaimedSubmission(message: string | undefined): boolean {
  if (!message) return false;
  return SUBMISSION_CLAIMS.some((re) => re.test(message));
}

/**
 * Close the application as submitted. BOTH gates live HERE, in the tool:
 * the pipeline must be parked at the submit step, and the user's own latest
 * message must actually say they submitted. The model's `confirmedByUser`
 * input is required but proves nothing (the model writes its own inputs — a
 * review found it was the only "consent" check); the message check is the one
 * that holds.
 */
export const markSubmittedTool: Tool<{ confirmedByUser: boolean }, { taskId: string }> = {
  id: "mark_submitted",
  description:
    "Record that the user submitted this application. Only call this when the user's own message says they submitted — it closes the application.",
  parse: (input) => {
    const confirmed = (input as { confirmedByUser?: unknown } | null)?.confirmedByUser;
    if (confirmed !== true) throw new Error("confirmedByUser must be true");
    return { confirmedByUser: true };
  },
  run: async (ctx) => {
    const taskId = requireTaskId(ctx);
    // The gate is checked HERE, not only inside the service: a refusal has to
    // read as "waiting for you", not as an outage a ladder should retry.
    const key = stepKeyOf(ctx.db, taskId);
    if (key !== "submit") {
      return gateRefusal(key ?? "an earlier step") as ToolObservation<{ taskId: string }>;
    }
    if (!userClaimedSubmission(ctx.latestUserMessage)) {
      return {
        ok: false,
        summary: "needs the user's own confirmation",
        failure: {
          kind: "human-gate",
          reason:
            'the user\'s message does not say they submitted this application — ask them to confirm explicitly (e.g. "I submitted it") and do not call this again until they do',
        },
      };
    }
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
  [refineArtifactTool.id]: refineArtifactTool,
  [draftAnswerTool.id]: draftAnswerTool,
  [computeFitTool.id]: computeFitTool,
  [openFillTool.id]: openFillTool,
  [markSubmittedTool.id]: markSubmittedTool,
} as const;

export { gateRefusal };
