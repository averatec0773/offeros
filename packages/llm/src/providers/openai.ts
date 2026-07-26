import { LlmError, OPENAI_MODEL } from "../errors";
import type { ProviderCallArgs } from "./types";

interface OpenAiChoice {
  message?: { content?: string };
}

export async function callOpenAI(
  args: ProviderCallArgs,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (args.key.trim() === "") {
    throw new LlmError("no_key", "No OpenAI API key configured.");
  }

  const messages: { role: string; content: string }[] = [];
  if (args.system.trim() !== "") messages.push({ role: "system", content: args.system });
  messages.push({ role: "user", content: args.userPrompt });

  const body: Record<string, unknown> = {
    model: args.model ?? OPENAI_MODEL,
    max_tokens: args.maxTokens,
    messages,
  };
  // Strict structured output: our task schemas are strict-compliant
  // (additionalProperties:false + every property required), so strict mode
  // guarantees the response matches the schema exactly — the same conformance
  // Anthropic's output_config gives. The task's own parse() still validates.
  if (args.schema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: "output", schema: args.schema, strict: true },
    };
  }

  let res: Response;
  try {
    res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${args.key}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new LlmError("http", `Network error calling OpenAI: ${String(e)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new LlmError("http", `OpenAI API returned ${res.status}: ${detail.slice(0, 300)}`);
  }

  let payload: { choices?: OpenAiChoice[] };
  try {
    payload = (await res.json()) as { choices?: OpenAiChoice[] };
  } catch {
    throw new LlmError("bad_output", "OpenAI response was not valid JSON.");
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new LlmError("bad_output", "OpenAI response contained no message content.");
  }
  return content;
}
