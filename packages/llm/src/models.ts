import type { LlmProvider } from "./providers/types";

export interface ModelOption {
  id: string;
  label: string;
}

// Data-driven model catalog per provider. The first entry of each list is the
// provider default (matches ANTHROPIC_MODEL / OPENAI_MODEL in errors.ts); adding
// a model is a one-line change here, and Settings renders whatever this holds.
export const MODELS: Record<LlmProvider, ModelOption[]> = {
  anthropic: [
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  ],
};

export function modelsFor(provider: LlmProvider): ModelOption[] {
  return MODELS[provider];
}

/**
 * The chosen model to send, or `undefined` to let the provider apply its default.
 * Guards against a stale cross-provider selection: a saved model that does not
 * belong to the active provider resolves to `undefined` rather than a broken call.
 */
export function resolveModel(provider: LlmProvider, userModel: string): string | undefined {
  const m = userModel.trim();
  return MODELS[provider].some((o) => o.id === m) ? m : undefined;
}
