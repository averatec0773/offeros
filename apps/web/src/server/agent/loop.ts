import { runTool } from "./run-tool";
import { READ_TOOLS, toolMenu } from "./read-tools";
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
 *   - Only READ tools are reachable here. The agent's job is to explain and to
 *     triage, and a single application takes about two minutes of wall clock
 *     with the user watching — reasoning inside that path buys nothing and
 *     costs latency, money and repeatability. Acting tools stay with the
 *     pipeline until there is trace data to justify moving them.
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
  runLlm: (args: {
    system: string;
    userPrompt: string;
    schema?: Record<string, unknown>;
  }) => Promise<string>;
  /** Swappable so tests can drive the loop without a provider. */
  chooseNext?: typeof decide;
  /** Read tools, keyed by id. Injectable for tests. */
  tools?: Record<string, Tool<never, unknown>>;
  maxSteps?: number;
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

export async function runTurn(args: RunTurnArgs): Promise<TurnResult> {
  const tools = args.tools ?? (READ_TOOLS as unknown as Record<string, Tool<never, unknown>>);
  const chooseNext = args.chooseNext ?? decide;
  const maxSteps = args.maxSteps ?? DEFAULT_MAX_STEPS;
  const steps: AgentStep[] = [];
  // What the agent has learned this turn, in the order it learned it. Rebuilt
  // into the prompt each time rather than kept as chat history: the model needs
  // the findings, not a transcript of its own earlier phrasing.
  const findings: string[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const decision: Decision = await chooseNext({
      context: buildContext(tools, findings),
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

    const observation = await runTool(
      tool,
      { ...args.ctx, reason: decision.reason },
      decision.input,
    );
    steps.push({
      tool: tool.id,
      reason: decision.reason,
      ok: observation.ok,
      summary: observation.summary,
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

/**
 * What the model sees.
 *
 * The tool menu, then the findings so far — nothing else. Progressive
 * disclosure is the point: a fill report has seventy rows and a campaign has
 * many reports, so the agent is given the means to fetch what it needs rather
 * than everything up front. What it has already fetched stays, because
 * dropping it would make the loop re-fetch and pay twice.
 */
function buildContext(tools: Record<string, Tool<never, unknown>>, findings: string[]): string {
  const menu = `Tools you can use:\n${toolMenu(tools)}`;
  if (findings.length === 0) {
    return `${menu}\n\nYou have not looked at anything yet.`;
  }
  return `${menu}\n\nWhat you have found so far:\n${findings.join("\n\n")}`;
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
