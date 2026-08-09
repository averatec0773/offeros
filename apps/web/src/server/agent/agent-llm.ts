import { callProvider, resolveModel, LlmError } from "@offeros/llm";
import { getSettings } from "../repositories/settings-repo";
import { apiKeyFor } from "../pipeline/context";
import type { Db } from "../db/client";

/**
 * The agent's line to a model.
 *
 * The pipeline's `runLlm` is task-registry shaped — a task id and an input,
 * with the prompt resolved from settings. The agent does not have a task; it
 * has a system prompt and whatever it has gathered this turn. So it calls the
 * provider directly, through the same key and model resolution every other
 * feature uses, rather than growing a second notion of "which model am I".
 *
 * Missing key is a first-class outcome, not a crash: this app is bring-your-own
 * key, and "you have not connected a provider" is a normal state the UI already
 * knows how to show.
 */

/** How much one decision may cost. Decisions are short — a tool name and a
 *  reason, or a few sentences — and a large ceiling only buys rambling. */
const MAX_TOKENS = 1200;

export function makeAgentLlm(db: Db) {
  return async (args: {
    system: string;
    userPrompt: string;
    schema?: Record<string, unknown>;
  }): Promise<string> => {
    const settings = getSettings(db);
    const provider = settings.llm.provider;
    const key = apiKeyFor(provider, settings);
    if (!key) {
      throw new LlmError("no_key", `No API key for ${provider}. Connect one in Settings → AI.`);
    }
    return callProvider(provider, {
      key,
      system: args.system,
      userPrompt: args.userPrompt,
      ...(args.schema ? { schema: args.schema } : {}),
      ...(resolveModel(provider, settings.llm.model ?? "")
        ? { model: resolveModel(provider, settings.llm.model ?? "") }
        : {}),
      maxTokens: MAX_TOKENS,
    });
  };
}
