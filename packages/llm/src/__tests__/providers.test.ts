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
