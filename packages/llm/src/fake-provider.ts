import type { LlmProvider, ProviderCallArgs } from "./providers/types";

/** Deterministic provider for tests: returns whatever `scripted` produces from the args. */
export function makeFakeProvider(scripted: (args: ProviderCallArgs) => string) {
  return async (_provider: LlmProvider, args: ProviderCallArgs): Promise<string> => scripted(args);
}
