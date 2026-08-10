import { runTool } from "./run-tool";
import { READ_TOOLS, toolMenu } from "./read-tools";
import { TOOLS as ACT_TOOLS } from "./tools";
import { WRITE_TOOLS } from "./write-tools";
import { decide, type Decision } from "./decide";
import type { Tool, ToolContext } from "./types";

/**
 * One turn of the agent.
 *
 * look → decide → act → look again, until it has enough to answer. That is the
 * whole loop; everything that makes it useful lives outside it, in the tools it
 * can reach and the record it leaves behind.
 *
 * Two decisions shape this file, both from what the project already learned:
 *
 *   - Reads and acts are both reachable, but they are not the same kind of
 *     thing and the loop does not treat them as one. Reading is free and
 *     reversible; acting spends the user's money (an LLM step) or changes a
 *     record. So acting is capped separately, and the cap is small.
 *   - Nothing here can step past a human gate. Not because the loop checks —
 *     it does not — but because each acting tool checks its own precondition.
 *     A caller that could talk its way past a gate is exactly the failure the
 *     tool contract was built to make impossible.
 *   - Every tool call goes through `runTool`, so each one is verified and
 *     written to the trace with the reason the agent gave. The transcript the
 *     user reads and the ledger the developer reads are the same events.
 */

/** A step the user can watch: what the agent looked at, and why. */
export interface AgentStep {
  tool: string;
  reason: string;
  ok: boolean;
  summary: string;
  /** True when this step changed something rather than looked at it. */
  acted?: boolean;
  /** Which application the step ran against — what lets the UI link a
   *  produced artifact ("tailored résumé v2") to the workspace it lives in.
   *  A step whose output cannot be found is an output that may as well not
   *  exist; this field is the fix for exactly that report. */
  applicationId?: string;
}

export interface TurnResult {
  answer: string;
  steps: AgentStep[];
  /** True when the loop hit its step budget before the agent chose to answer. */
  ranOutOfSteps: boolean;
}

export interface RunTurnArgs {
  ctx: ToolContext;
  question: string;
  /**
   * Resolve an application the agent named, so a campaign-level conversation
   * can move between jobs. Absent means the conversation is pinned to one
   * application and the agent may not wander.
   */
  focus?: (applicationId: string) => { applicationId: string; taskId?: string } | null;
  /**
   * Who the conversation is about, in one line ("Senior Engineer at Acme").
   *
   * Without it the agent asks which job the user means — reasonably, since the
   * scope lives in `ctx` where only tools can see it. The chat is mounted on
   * one application's workspace, so "this one" is unambiguous to the user and
   * has to be unambiguous to the agent too.
   */
  subject?: string;
  /**
   * The recent conversation, oldest first — what makes "the second one" and
   * "do that too" resolvable. Reference only: facts still come from tools
   * every turn, never from what an earlier answer claimed. Kept as a plain
   * transcript window (no summarisation) because threads here are short and
   * the durable memory this must not duplicate lives in the database.
   */
  history?: { role: "user" | "assistant"; content: string }[];
  runLlm: (args: {
    system: string;
    userPrompt: string;
    schema?: Record<string, unknown>;
  }) => Promise<string>;
  /** Swappable so tests can drive the loop without a provider. */
  chooseNext?: typeof decide;
  /** Every tool the agent may reach, keyed by id. Injectable for tests. */
  tools?: Record<string, Tool<never, unknown>>;
  /** Which of those ids change something. Used for the separate action cap and
   *  to mark the step in the transcript, so a reader can see at a glance which
   *  lines were the agent doing rather than looking. */
  actingToolIds?: ReadonlySet<string>;
  maxSteps?: number;
  maxActions?: number;
}

/**
 * How many tool calls one question may cost.
 *
 * Small on purpose. Each step is a model call the user pays for, and a loop
 * that wanders is worse than one that stops and says what it still needs. Six
 * is enough to list, narrow, read a report and answer, with room to recover
 * from one wrong turn.
 */
const DEFAULT_MAX_STEPS = 6;

/**
 * How many of those steps may CHANGE something.
 *
 * Reading is cheap and undoable; acting generates documents, opens tickets and
 * writes records. Two per turn covers the natural compound request — "save
 * this answer and mark X interviewed" — while a plan that needs three changes
 * is still a plan the user should see before it runs, not one a loop performs
 * while they wait. (Was one before the write family existed.)
 */
const DEFAULT_MAX_ACTIONS = 2;

export async function runTurn(args: RunTurnArgs): Promise<TurnResult> {
  const tools =
    args.tools ??
    ({ ...READ_TOOLS, ...ACT_TOOLS, ...WRITE_TOOLS } as unknown as Record<
      string,
      Tool<never, unknown>
    >);
  // Writes count against the action budget exactly like the execution tools:
  // both change the world, and the cap is about world-changes per turn.
  const actingIds =
    args.actingToolIds ?? new Set([...Object.keys(ACT_TOOLS), ...Object.keys(WRITE_TOOLS)]);
  const maxActions = args.maxActions ?? DEFAULT_MAX_ACTIONS;
  let actionsTaken = 0;
  const chooseNext = args.chooseNext ?? decide;
  const maxSteps = args.maxSteps ?? DEFAULT_MAX_STEPS;
  const steps: AgentStep[] = [];
  // What the agent has learned this turn, in the order it learned it. Rebuilt
  // into the prompt each time rather than kept as chat history: the model needs
  // the findings, not a transcript of its own earlier phrasing.
  const findings: string[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const decision: Decision = await chooseNext({
      context: buildContext(tools, findings, args.subject, args.history),
      question: args.question,
      runLlm: args.runLlm,
    });

    if (decision.kind === "answer") {
      return { answer: decision.text, steps, ranOutOfSteps: false };
    }

    const tool = tools[decision.tool];
    if (!tool) {
      // A named tool that does not exist is a mistake the agent can recover
      // from, so it is a finding rather than an error — but it costs a step,
      // which keeps a model that keeps inventing tools from looping forever.
      findings.push(`You asked for a tool called "${decision.tool}". There is no such tool.`);
      steps.push({
        tool: decision.tool,
        reason: decision.reason,
        ok: false,
        summary: "no such tool",
      });
      continue;
    }

    // A tool call may name a different application — that is how one
    // conversation covers a whole campaign. Re-scoping here rather than inside
    // the tools keeps the ledger honest: `runTool` writes the trace against
    // ctx.applicationId, so the subject has to move with the call.
    const named = applicationIdIn(decision.input);
    let callCtx = args.ctx;
    if (named && named !== args.ctx.applicationId) {
      const resolved = args.focus?.(named);
      if (!resolved) {
        findings.push(
          `There is no application with id "${named}". Use list_applications to get real ids.`,
        );
        steps.push({
          tool: tool.id,
          reason: decision.reason,
          ok: false,
          summary: "no such application",
          acted: false,
        });
        continue;
      }
      callCtx = { ...args.ctx, ...resolved };
    }

    const acting = actingIds.has(tool.id);
    if (acting && actionsTaken >= maxActions) {
      // Refuse, and say so as a finding rather than an error: the agent can
      // still answer, and telling the user what it wanted to do next is more
      // useful than a loop that quietly stops short.
      findings.push(
        `You have already changed something this turn (${maxActions} change${maxActions === 1 ? "" : "s"} max), so ${tool.id} was not run. Tell the user what you would do next and let them ask for it.`,
      );
      steps.push({
        tool: tool.id,
        reason: decision.reason,
        ok: false,
        summary: "action budget spent — not run",
        acted: false,
      });
      continue;
    }
    const observation = await runTool(
      tool,
      { ...callCtx, reason: decision.reason },
      decision.input,
    );
    // The budget counts CHANGES, so it is spent after the fact and only when
    // something changed. A tool that refused its own gate, or failed, altered
    // nothing — charging for it would leave the agent unable to do the thing
    // the user actually needed.
    if (acting && observation.ok) actionsTaken++;
    steps.push({
      tool: tool.id,
      reason: decision.reason,
      ok: observation.ok,
      summary: observation.summary,
      acted: acting && observation.ok,
      applicationId: callCtx.applicationId,
    });
    findings.push(renderObservation(tool.id, observation));
  }

  // Out of steps. Say so plainly and hand back what was gathered; a loop that
  // silently truncates is indistinguishable from one that finished.
  return {
    answer:
      "I ran out of steps before I could answer that. Here is what I found so far:\n" +
      steps.map((s) => `- ${s.tool}: ${s.summary}`).join("\n"),
    steps,
    ranOutOfSteps: true,
  };
}

/** An application id the agent put in a tool's input, if it did. */
function applicationIdIn(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as { applicationId?: unknown }).applicationId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * What the model sees.
 *
 * The tool menu, then the findings so far — nothing else. Progressive
 * disclosure is the point: a fill report has seventy rows and a campaign has
 * many reports, so the agent is given the means to fetch what it needs rather
 * than everything up front. What it has already fetched stays, because
 * dropping it would make the loop re-fetch and pay twice.
 */
function buildContext(
  tools: Record<string, Tool<never, unknown>>,
  findings: string[],
  subject?: string,
  history?: { role: "user" | "assistant"; content: string }[],
): string {
  const scope = subject
    ? `You are looking at one application: ${subject}. Every tool you call is already scoped to it, so "this one" means this application — never ask the user which job they mean.`
    : `You are looking at ALL of the user's applications. Start with list_applications to get their ids, then pass {"applicationId":"<id>"} to any tool that is about one job. Answer about the whole set unless the user names one.`;
  // History is for RESOLVING the question ("the second one", "do that too"),
  // never for answering it: an earlier answer's claims may be stale the moment
  // a fill or an edit lands, so facts are re-read through tools every turn.
  const past =
    history && history.length > 0
      ? `Recent conversation (oldest first — use it to understand what the user is referring to, but re-read facts through tools rather than trusting earlier answers):\n${history
          .map((m) => `${m.role === "user" ? "User" : "You"}: ${m.content}`)
          .join("\n")}`
      : "";
  const menu = `Tools you can use:\n${toolMenu(tools)}`;
  const found =
    findings.length === 0
      ? "You have not looked at anything yet."
      : `What you have found so far:\n${findings.join("\n\n")}`;
  return [scope, past, menu, found].filter(Boolean).join("\n\n");
}

/**
 * A tool result, as text the model reads.
 *
 * JSON, because the results are already structured and re-describing them in
 * prose would be a second place for them to drift. Capped, because one runaway
 * result should not eat the window the reasoning needs.
 */
function renderObservation(
  toolId: string,
  observation: { ok: boolean; summary: string; result?: unknown; failure?: { reason: string } },
): string {
  const head = `${toolId}: ${observation.summary}`;
  if (!observation.ok) {
    return `${head}\n(failed: ${observation.failure?.reason ?? "no reason recorded"})`;
  }
  if (observation.result === undefined) return head;
  return `${head}\n${JSON.stringify(observation.result).slice(0, 4000)}`;
}
