import { ANTHROPIC_MODEL, LlmError } from "../errors";
import type { ProviderCallArgs } from "./types";

interface AnthropicBlock {
  type: string;
  text?: string;
}

export async function callAnthropic(
  args: ProviderCallArgs,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (args.key.trim() === "") {
    throw new LlmError("no_key", "No API key configured for anthropic. Add one in Settings → AI.");
  }

  const body: Record<string, unknown> = {
    model: args.model ?? ANTHROPIC_MODEL,
    max_tokens: args.maxTokens,
    messages: [{ role: "user", content: args.userPrompt }],
  };
  if (typeof args.temperature === "number") body.temperature = args.temperature;
  if (args.system.trim() !== "") body.system = args.system;
  if (args.schema) body.output_config = { format: { type: "json_schema", schema: args.schema } };

  let res: Response;
  try {
    res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": args.key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new LlmError("http", `Network error calling Anthropic: ${String(e)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new LlmError("http", `Anthropic API returned ${res.status}: ${detail.slice(0, 300)}`);
  }

  let payload: { content?: AnthropicBlock[] };
  try {
    payload = (await res.json()) as { content?: AnthropicBlock[] };
  } catch {
    throw new LlmError("bad_output", "Anthropic response was not valid JSON.");
  }

  const textBlock = (payload.content ?? []).find(
    (b) => b.type === "text" && typeof b.text === "string",
  );
  if (!textBlock?.text) {
    throw new LlmError("bad_output", "Anthropic response contained no text block.");
  }
  return textBlock.text;
}
