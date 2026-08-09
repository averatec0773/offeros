import { describe, expect, it, vi } from "vitest";
import { runTurn, type RunTurnArgs } from "../loop";
import { parseDecision } from "../decide";
import type { Decision } from "../decide";
import type { Tool, ToolContext } from "../types";

/**
 * The loop is driven by a scripted decision sequence rather than a provider.
 * What is worth testing here is the control flow — when it stops, what it does
 * with a bad choice, what the user is shown — and none of that should depend on
 * a model being reachable.
 */

const ctx = { db: {} as ToolContext["db"], applicationId: "app-1" };

const tool = (id: string, summary: string, result?: unknown): Tool<never, unknown> => ({
  id,
  description: `does ${id}`,
  run: async () => ({ ok: true, summary, result }),
  verify: async () => null,
});

type ChooseNext = NonNullable<RunTurnArgs["chooseNext"]>;

/** Hands back one scripted decision per call, in order. */
function script(...decisions: Decision[]) {
  let i = 0;
  const fn: ChooseNext = async () => decisions[Math.min(i++, decisions.length - 1)]!;
  return vi.fn(fn);
}

const noLlm = async () => {
  throw new Error("the loop must not reach a provider in these tests");
};

describe("runTurn", () => {
  it("answers without looking when the agent has nothing to look up", async () => {
    const chooseNext = script({ kind: "answer", text: "Nothing is in flight." });
    const out = await runTurn({
      ctx,
      question: "anything going on?",
      runLlm: noLlm,
      chooseNext,
      tools: {},
    });
    expect(out.answer).toBe("Nothing is in flight.");
    expect(out.steps).toEqual([]);
    expect(out.ranOutOfSteps).toBe(false);
  });

  it("uses a tool, then answers with what it found", async () => {
    const tools = { list_applications: tool("list_applications", "2 applications", { n: 2 }) };
    const chooseNext = script(
      { kind: "use-tool", tool: "list_applications", reason: "need the list first" },
      { kind: "answer", text: "You have two." },
    );
    const out = await runTurn({ ctx, question: "how many?", runLlm: noLlm, chooseNext, tools });

    expect(out.answer).toBe("You have two.");
    expect(out.steps).toEqual([
      {
        tool: "list_applications",
        reason: "need the list first",
        ok: true,
        summary: "2 applications",
      },
    ]);
  });

  it("feeds each result forward, so the next decision can build on it", async () => {
    const tools = {
      a: tool("a", "found the job", { id: "app-9" }),
      b: tool("b", "read the report"),
    };
    const chooseNext = script(
      { kind: "use-tool", tool: "a", reason: "find it" },
      { kind: "use-tool", tool: "b", reason: "now read it" },
      { kind: "answer", text: "done" },
    );
    await runTurn({ ctx, question: "why did it stall?", runLlm: noLlm, chooseNext, tools });

    // The third call must have been able to see both results.
    const lastContext = chooseNext.mock.calls.at(-1)![0].context;
    expect(lastContext).toContain("found the job");
    expect(lastContext).toContain("app-9");
    expect(lastContext).toContain("read the report");
  });

  it("survives a tool that does not exist, and says so in the step list", async () => {
    // A model naming a tool it invented must not take the turn down.
    const chooseNext = script(
      { kind: "use-tool", tool: "send_email", reason: "emailing them" },
      { kind: "answer", text: "I cannot do that." },
    );
    const out = await runTurn({
      ctx,
      question: "email them",
      runLlm: noLlm,
      chooseNext,
      tools: {},
    });

    expect(out.steps[0]).toMatchObject({ tool: "send_email", ok: false, summary: "no such tool" });
    expect(out.answer).toBe("I cannot do that.");
    // And the mistake was fed back, so the agent can correct itself.
    expect(chooseNext.mock.calls.at(-1)![0].context).toContain("There is no such tool");
  });

  it("stops at the step budget instead of looping, and says it stopped", async () => {
    const tools = { a: tool("a", "looked again") };
    // A decision function that never chooses to answer.
    const chooseNext = script({ kind: "use-tool", tool: "a", reason: "one more" });
    const out = await runTurn({
      ctx,
      question: "go forever",
      runLlm: noLlm,
      chooseNext,
      tools,
      maxSteps: 3,
    });

    expect(out.steps).toHaveLength(3);
    expect(out.ranOutOfSteps).toBe(true);
    // The user is told, and shown the partial work rather than nothing.
    expect(out.answer).toContain("ran out of steps");
    expect(out.answer).toContain("looked again");
  });

  it("reports a failed tool without ending the turn", async () => {
    const failing: Tool<never, unknown> = {
      id: "read_fill_report",
      description: "reads",
      run: async () => ({
        ok: false,
        summary: "no fill yet",
        failure: { kind: "precondition", reason: "this task has never run a fill" },
      }),
      verify: async () => null,
    };
    const chooseNext = script(
      { kind: "use-tool", tool: "read_fill_report", reason: "check the fill" },
      { kind: "answer", text: "It has not been filled yet." },
    );
    const out = await runTurn({
      ctx,
      question: "why did it fail?",
      runLlm: noLlm,
      chooseNext,
      tools: { read_fill_report: failing },
    });

    expect(out.steps[0]!.ok).toBe(false);
    expect(chooseNext.mock.calls.at(-1)![0].context).toContain("never run a fill");
    expect(out.answer).toBe("It has not been filled yet.");
  });
});

describe("parseDecision", () => {
  it("reads both decision shapes", () => {
    expect(parseDecision('{"kind":"use-tool","tool":"read_trace","reason":"check"}')).toEqual({
      kind: "use-tool",
      tool: "read_trace",
      input: undefined,
      reason: "check",
    });
    expect(parseDecision('{"kind":"answer","text":"hello"}')).toEqual({
      kind: "answer",
      text: "hello",
    });
  });

  it("treats an unparseable reply as an answer rather than throwing", () => {
    // Showing what came back beats a generic apology: an unparseable reply is
    // usually still readable, and hiding it makes the failure unreportable.
    const out = parseDecision("Sorry, I think you should check the Ashby form.");
    expect(out.kind).toBe("answer");
    expect(out).toHaveProperty("text", "Sorry, I think you should check the Ashby form.");
  });

  it("refuses a tool decision that names no tool", () => {
    expect(parseDecision('{"kind":"use-tool","tool":"  "}').kind).toBe("answer");
  });

  it("says something rather than nothing when the reply is empty", () => {
    expect(parseDecision("")).toMatchObject({ kind: "answer" });
    expect((parseDecision("") as { text: string }).text).not.toBe("");
  });
});
