import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmProvider, ProviderCallArgs } from "@offeros/llm";
import { createDb, type Db } from "../../db/client";
import { getSettings, saveSettings } from "../../repositories/settings-repo";
import { upsertStyleMemory } from "../../repositories/style-memory-repo";
import { makePipelineContext } from "../context";

let db: Db;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-context-"));
  db = createDb(join(dir, "s.db"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

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

describe("apiKeyFor — settings-first key resolution", () => {
  it("uses the saved settings key even when an env var is also set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "env-key");
    const current = getSettings(db);
    saveSettings(db, {
      ...current,
      llm: { ...current.llm, apiKeys: { anthropic: "saved-key" } },
    });

    const recorded: ProviderCallArgs[] = [];
    const ctx = makePipelineContext(db, "task-1", { callProvider: fakeCallProvider(recorded) });
    await ctx.runLlm("cover-letter", INPUT);

    expect(recorded[0]!.key).toBe("saved-key");
  });

  it("falls back to the env var when no saved key is set, trimming its surrounding whitespace", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "  env-key\n");

    const recorded: ProviderCallArgs[] = [];
    const ctx = makePipelineContext(db, "task-1", { callProvider: fakeCallProvider(recorded) });
    await ctx.runLlm("cover-letter", INPUT);

    expect(recorded[0]!.key).toBe("env-key");
  });

  it("falls back to the env var when the saved key is blank", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "env-key");
    const current = getSettings(db);
    saveSettings(db, {
      ...current,
      llm: { ...current.llm, apiKeys: { anthropic: "   " } },
    });

    const recorded: ProviderCallArgs[] = [];
    const ctx = makePipelineContext(db, "task-1", { callProvider: fakeCallProvider(recorded) });
    await ctx.runLlm("cover-letter", INPUT);

    expect(recorded[0]!.key).toBe("env-key");
  });

  it("trims surrounding whitespace off a saved key before using it", async () => {
    const current = getSettings(db);
    saveSettings(db, {
      ...current,
      llm: { ...current.llm, apiKeys: { anthropic: "  saved-key\n" } },
    });

    const recorded: ProviderCallArgs[] = [];
    const ctx = makePipelineContext(db, "task-1", { callProvider: fakeCallProvider(recorded) });
    await ctx.runLlm("cover-letter", INPUT);

    expect(recorded[0]!.key).toBe("saved-key");
  });

  it("resolves to an empty string when neither settings nor env has a key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const recorded: ProviderCallArgs[] = [];
    const ctx = makePipelineContext(db, "task-1", { callProvider: fakeCallProvider(recorded) });
    await ctx.runLlm("cover-letter", INPUT);

    expect(recorded[0]!.key).toBe("");
  });
});

describe("repos.getStyleNotes — style-memory registry binding", () => {
  it("returns null when no style memory exists for the kind", () => {
    const ctx = makePipelineContext(db, "task-1");
    expect(ctx.repos.getStyleNotes("resume")).toBeNull();
    expect(ctx.repos.getStyleNotes("cover-letter")).toBeNull();
  });

  it("returns the stored notes for the kind once distilled/saved", () => {
    upsertStyleMemory(db, "resume", { notes: "- Prefers active voice.", sourceCount: 1 });
    const ctx = makePipelineContext(db, "task-1");
    expect(ctx.repos.getStyleNotes("resume")).toBe("- Prefers active voice.");
    expect(ctx.repos.getStyleNotes("cover-letter")).toBeNull();
  });
});
