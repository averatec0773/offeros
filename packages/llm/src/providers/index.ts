import { LlmError } from "../errors";
import { callAnthropic } from "./anthropic";
import { callOpenAI } from "./openai";
import type { LlmProvider, ProviderCallArgs } from "./types";

export { callAnthropic } from "./anthropic";
export { callOpenAI } from "./openai";
export type { LlmProvider, ProviderCallArgs } from "./types";

export async function callProvider(
  provider: LlmProvider,
  args: ProviderCallArgs,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (provider === "anthropic") return callAnthropic(args, fetchImpl);
  if (provider === "openai") return callOpenAI(args, fetchImpl);
  throw new LlmError("unsupported_provider", `Provider not supported: ${provider}`);
}
