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
        acted: false,
        // Steps carry the application they ran against, so the UI can link a
        // produced artifact to the workspace it lives in.
        applicationId: "app-1",
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

describe("acting tools", () => {
  const acting = (id: string): Tool<never, unknown> => ({
    id,
    description: `changes ${id}`,
    run: async () => ({ ok: true, summary: `${id} done` }),
    verify: async () => null,
  });

  it("allows two changes per turn and refuses the third", async () => {
    // Reading is free and undoable; acting spends money or writes records.
    // Two covers the natural compound request ("save this and mark that");
    // a plan needing three is one the user should see before it runs.
    const tools = {
      a: acting("a"),
      b: acting("b"),
      c: acting("c"),
      look: tool("look", "looked"),
    };
    const chooseNext = script(
      { kind: "use-tool", tool: "a", reason: "first" },
      { kind: "use-tool", tool: "b", reason: "second" },
      { kind: "use-tool", tool: "c", reason: "third" },
      { kind: "answer", text: "I did two things." },
    );
    const out = await runTurn({
      ctx,
      question: "fix it",
      runLlm: noLlm,
      chooseNext,
      tools,
      actingToolIds: new Set(["a", "b", "c"]),
    });

    expect(out.steps[0]).toMatchObject({ tool: "a", ok: true, acted: true });
    expect(out.steps[1]).toMatchObject({ tool: "b", ok: true, acted: true });
    expect(out.steps[2]).toMatchObject({ tool: "c", ok: false, acted: false });
    expect(out.steps[2]!.summary).toContain("action budget spent");
    // The refusal is fed back so the agent can tell the user what is next.
    expect(chooseNext.mock.calls.at(-1)![0].context).toContain("already changed something");
  });

  it("does not count looking against the action budget", async () => {
    const tools = { look: tool("look", "looked"), act: acting("act") };
    const chooseNext = script(
      { kind: "use-tool", tool: "look", reason: "1" },
      { kind: "use-tool", tool: "look", reason: "2" },
      { kind: "use-tool", tool: "act", reason: "now do it" },
      { kind: "answer", text: "done" },
    );
    const out = await runTurn({
      ctx,
      question: "look then act",
      runLlm: noLlm,
      chooseNext,
      tools,
      actingToolIds: new Set(["act"]),
    });
    expect(out.steps.filter((s) => s.acted)).toHaveLength(1);
    expect(out.steps.at(-1)).toMatchObject({ tool: "act", ok: true });
  });

  it("a tool that refuses its own gate does not spend the action budget", async () => {
    // The gate lives in the tool. A refusal changed nothing, so the agent
    // should still be able to do the thing the user actually needs.
    const gated: Tool<never, unknown> = {
      id: "mark_submitted",
      description: "closes it",
      run: async () => ({
        ok: false,
        summary: "waiting for you at fill-form",
        failure: { kind: "human-gate", reason: "the task is parked at the fill-form gate" },
      }),
      verify: async () => null,
    };
    const tools = { mark_submitted: gated, tailor: acting("tailor") };
    const chooseNext = script(
      { kind: "use-tool", tool: "mark_submitted", reason: "closing it" },
      { kind: "use-tool", tool: "tailor", reason: "tailor instead" },
      { kind: "answer", text: "tailored" },
    );
    const out = await runTurn({
      ctx,
      question: "close it",
      runLlm: noLlm,
      chooseNext,
      tools,
      actingToolIds: new Set(["mark_submitted", "tailor"]),
    });
    expect(out.steps[0]).toMatchObject({ ok: false, acted: false });
    expect(out.steps[1]).toMatchObject({ tool: "tailor", ok: true, acted: true });
  });
});

describe("campaign scope", () => {
  /** Records the application each call was scoped to, which is what the trace
   *  would have recorded. */
  function spyingTool(seen: string[]): Tool<never, unknown> {
    return {
      id: "read_fill_report",
      description: "reads one job's fill",
      run: async (c) => {
        seen.push(c.applicationId);
        return { ok: true, summary: `read ${c.applicationId}` };
      },
      verify: async () => null,
    };
  }

  it("re-scopes a call to the application the agent named", async () => {
    // The whole point of a campaign conversation: one turn, several jobs. The
    // subject has to move with the call, because runTool writes the trace
    // against ctx.applicationId — otherwise work lands on the wrong job's
    // ledger.
    const seen: string[] = [];
    const chooseNext = script(
      {
        kind: "use-tool",
        tool: "read_fill_report",
        input: { applicationId: "app-2" },
        reason: "b",
      },
      {
        kind: "use-tool",
        tool: "read_fill_report",
        input: { applicationId: "app-3" },
        reason: "c",
      },
      { kind: "answer", text: "both read" },
    );
    await runTurn({
      ctx,
      question: "why are these stuck?",
      runLlm: noLlm,
      chooseNext,
      tools: { read_fill_report: spyingTool(seen) },
      // No taskId: runTool independently checks that a task belongs to the
      // application it is filed under, and that guard has its own test.
      focus: (id) => ({ applicationId: id }),
    });
    expect(seen).toEqual(["app-2", "app-3"]);
  });

  it("stays on the pinned application when no focus resolver is given", async () => {
    // A per-application conversation must not wander, even if the model asks.
    const seen: string[] = [];
    const chooseNext = script(
      {
        kind: "use-tool",
        tool: "read_fill_report",
        input: { applicationId: "app-9" },
        reason: "x",
      },
      { kind: "answer", text: "done" },
    );
    const out = await runTurn({
      ctx,
      question: "look at another job",
      runLlm: noLlm,
      chooseNext,
      tools: { read_fill_report: spyingTool(seen) },
    });
    expect(seen).toEqual([]);
    expect(out.steps[0]).toMatchObject({ ok: false, summary: "no such application" });
  });

  it("tells the agent when it names an id that does not exist", async () => {
    const chooseNext = script(
      {
        kind: "use-tool",
        tool: "read_fill_report",
        input: { applicationId: "made-up" },
        reason: "x",
      },
      { kind: "answer", text: "I used a bad id." },
    );
    const out = await runTurn({
      ctx,
      question: "why is X stuck?",
      runLlm: noLlm,
      chooseNext,
      tools: { read_fill_report: spyingTool([]) },
      focus: () => null,
    });
    expect(out.steps[0]!.ok).toBe(false);
    expect(chooseNext.mock.calls.at(-1)![0].context).toContain("no application with id");
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

describe("duplicate-call guard", () => {
  it("refuses an identical repeat and tells the agent its result is already there", async () => {
    // The real transcript this pins: the same report read four times with
    // reworded reasons while the answer sat unused in step two.
    const tools = { look: tool("look", "the answer") };
    const chooseNext = script(
      { kind: "use-tool", tool: "look", reason: "first read" },
      { kind: "use-tool", tool: "look", reason: "read it again to be sure" },
      { kind: "answer", text: "fine, using what I have" },
    );
    const out = await runTurn({
      ctx,
      question: "what is it",
      runLlm: noLlm,
      chooseNext,
      tools,
      actingToolIds: new Set(),
    });
    expect(out.steps[0]).toMatchObject({ tool: "look", ok: true });
    expect(out.steps[1]).toMatchObject({ tool: "look", ok: false });
    expect(out.steps[1]!.summary).toContain("duplicate call");
    expect(chooseNext.mock.calls.at(-1)![0].context).toContain("already called look");
  });

  it("the same tool with DIFFERENT input is not a duplicate", async () => {
    const byInput: Tool<{ q: string }, unknown> = {
      id: "look",
      description: "look",
      parse: (i) => i as { q: string },
      run: async (_c, i) => ({ ok: true, summary: `saw ${i.q}` }),
      verify: async () => null,
    };
    const chooseNext = script(
      { kind: "use-tool", tool: "look", reason: "a", input: { q: "one" } },
      { kind: "use-tool", tool: "look", reason: "b", input: { q: "two" } },
      { kind: "answer", text: "both seen" },
    );
    const out = await runTurn({
      ctx,
      question: "compare",
      runLlm: noLlm,
      chooseNext,
      tools: { look: byInput as never },
      actingToolIds: new Set(),
    });
    expect(out.steps[0]).toMatchObject({ ok: true, summary: "saw one" });
    expect(out.steps[1]).toMatchObject({ ok: true, summary: "saw two" });
  });
});
