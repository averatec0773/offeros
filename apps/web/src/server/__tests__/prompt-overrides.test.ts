import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTask, type LlmProvider, type ProviderCallArgs } from "@offeros/llm";
import { createDb, type Db } from "../db/client";
import { getSettings, saveSettings } from "../repositories/settings-repo";
import { makePipelineContext } from "../pipeline/context";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-prompt-overrides-"));
  db = createDb(join(dir, "s.db"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const INPUT = {
  jobInfo: { jobId: "j1", jobTitle: "ML Engineer", companyName: "Acme" },
  groundingFacts: "Jordan Rivera, 5 years Python.",
};

function fakeCallProvider(recorded: ProviderCallArgs[]) {
  return async (_provider: LlmProvider, args: ProviderCallArgs): Promise<string> => {
    recorded.push(args);
    return JSON.stringify({ content: "Dear Hiring Team,\n\n...", rationale: "test" });
  };
}

describe("settings-driven prompt overrides reach the provider", () => {
  it("falls back to the task's default system prompt when no override is stored", async () => {
    const recorded: ProviderCallArgs[] = [];
    const ctx = makePipelineContext(db, "task-1", { callProvider: fakeCallProvider(recorded) });

    await ctx.runLlm("cover-letter", INPUT);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.system).toBe(getTask("cover-letter")!.defaultSystemPrompt);
  });

  it("uses the settings override for the task once one is saved", async () => {
    const current = getSettings(db);
    saveSettings(db, {
      ...current,
      llm: { ...current.llm, promptOverrides: { "cover-letter": "MY CUSTOM PROMPT" } },
    });

    const recorded: ProviderCallArgs[] = [];
    const ctx = makePipelineContext(db, "task-1", { callProvider: fakeCallProvider(recorded) });

    await ctx.runLlm("cover-letter", INPUT);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.system).toBe("MY CUSTOM PROMPT");
  });
});
