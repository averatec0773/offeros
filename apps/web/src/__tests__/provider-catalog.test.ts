import { describe, it, expect } from "vitest";
import { llmSettingsSchema } from "@offeros/core";
import { LLM_PROVIDERS } from "@offeros/llm";

// Drift guard for the duplication called out in packages/core/src/settings.ts:
// core hand-keys its provider enum because it cannot import @offeros/llm
// (layering). If a provider is ever added/removed in the llm package's
// catalog without updating core's schema, this fails instead of the two
// silently disagreeing at runtime.
describe("provider catalog drift guard", () => {
  it("core's llm settings provider enum matches @offeros/llm's LLM_PROVIDERS", () => {
    const options = llmSettingsSchema.shape.provider.removeDefault().options;
    expect(options).toEqual(LLM_PROVIDERS);
  });
});
