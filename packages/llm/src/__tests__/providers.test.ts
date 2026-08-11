import { describe, it, expect } from "vitest";
import { callAnthropic } from "../providers/anthropic";
import { callOpenAI } from "../providers/openai";
import type { ProviderCallArgs } from "../providers/types";

const args: ProviderCallArgs = {
  key: "",
  system: "",
  userPrompt: "hi",
  maxTokens: 100,
};

describe("provider no_key messages", () => {
  it("callAnthropic points the user at Settings → AI", async () => {
    await expect(callAnthropic(args)).rejects.toThrow(
      "No API key configured for anthropic. Add one in Settings → AI.",
    );
  });

  it("callOpenAI points the user at Settings → AI", async () => {
    await expect(callOpenAI(args)).rejects.toThrow(
      "No API key configured for openai. Add one in Settings → AI.",
    );
  });
});

describe("temperature is passed through only when set", () => {
  const capture = () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "ok" }],
          choices: [{ message: { content: "ok" } }],
        }),
        text: async () => "",
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return { get: () => body, fetchImpl };
  };

  it("anthropic includes temperature when provided, omits it otherwise", async () => {
    const withT = capture();
    await callAnthropic(
      { key: "k", system: "", userPrompt: "hi", maxTokens: 10, temperature: 0.1 },
      withT.fetchImpl,
    );
    expect(withT.get().temperature).toBe(0.1);

    const withoutT = capture();
    await callAnthropic(
      { key: "k", system: "", userPrompt: "hi", maxTokens: 10 },
      withoutT.fetchImpl,
    );
    expect("temperature" in withoutT.get()).toBe(false);
  });

  it("openai includes temperature when provided, omits it otherwise", async () => {
    const withT = capture();
    await callOpenAI(
      { key: "k", system: "", userPrompt: "hi", maxTokens: 10, temperature: 0.1 },
      withT.fetchImpl,
    );
    expect(withT.get().temperature).toBe(0.1);

    const withoutT = capture();
    await callOpenAI({ key: "k", system: "", userPrompt: "hi", maxTokens: 10 }, withoutT.fetchImpl);
    expect("temperature" in withoutT.get()).toBe(false);
  });
});
