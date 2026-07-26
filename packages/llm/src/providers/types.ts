/** Local to this package — the extension's `LlmProvider` (from `../settings`) is not imported here so `@offeros/llm` stays self-contained. */
export type LlmProvider = "anthropic" | "openai";

export interface ProviderCallArgs {
  key: string;
  system: string;
  userPrompt: string;
  schema?: Record<string, unknown>;
  /** Optional; each provider falls back to its own default model when unset. */
  model?: string;
  maxTokens: number;
}
