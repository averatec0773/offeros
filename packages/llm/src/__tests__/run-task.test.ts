import { describe, it, expect } from "vitest";
import { runTask, type RunTaskDeps } from "../run-task";
import { makeFakeProvider } from "../fake-provider";
import { getTask } from "../registry";

function deps(over: Partial<RunTaskDeps> = {}): RunTaskDeps {
  return {
    getTask,
    getOverride: async () => null,
    getModelOverride: async () => null,
    getProvider: async () => "anthropic",
    getKey: async () => "test-key",
    getModel: async () => "claude-sonnet-5",
    callProvider: makeFakeProvider((a) => JSON.stringify({ echoedSystem: a.system })),
    ...over,
  };
}

describe("runTask prompt resolution", () => {
  it("uses the per-task system-prompt override when present", async () => {
    const seen: string[] = [];
    const d = deps({
      getOverride: async () => "MY CUSTOM PROMPT",
      callProvider: makeFakeProvider((a) => {
        seen.push(a.system);
        return "OK";
      }),
    });
    await runTask("cover-letter", { jobInfo: {}, groundingFacts: "" }, d).catch(() => {});
    expect(seen[0]).toBe("MY CUSTOM PROMPT");
  });

  it("falls back to the task default prompt when no override", async () => {
    const seen: string[] = [];
    const d = deps({
      callProvider: makeFakeProvider((a) => {
        seen.push(a.system);
        return "OK";
      }),
    });
    await runTask("cover-letter", { jobInfo: {}, groundingFacts: "" }, d).catch(() => {});
    expect(seen[0]).toContain("Dear Hiring Team");
  });

  it("throws on an unknown task", async () => {
    await expect(runTask("nope", {}, deps())).rejects.toThrow();
  });
});
