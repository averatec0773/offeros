import { z } from "zod";
import { callProvider, resolveModel, LLM_PROVIDERS, type LlmProvider } from "@offeros/llm";
import { getDb } from "@/server/db/client";
import { getSettings } from "@/server/repositories/settings-repo";
import { envApiKeyFor } from "@/server/pipeline/context";
import { badRequest, handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

const bodySchema = z.object({
  provider: z.enum(LLM_PROVIDERS as [LlmProvider, ...LlmProvider[]]),
  model: z.string().optional(),
  key: z.string().optional(),
});

/**
 * Fires a one-line ping through the real provider transport so the settings
 * UI can report live connectivity. The provider call is caught locally and
 * always surfaces as a plain 400 with the provider's own message — including
 * an unconfigured key — never the 42000 no-key envelope. This route IS the
 * settings surface a user reaches for after seeing "no key" elsewhere.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = bodySchema.parse(await request.json());
    const settings = getSettings(getDb());
    const key =
      body.key?.trim() ||
      settings.llm.apiKeys[body.provider]?.trim() ||
      envApiKeyFor(body.provider);
    try {
      await callProvider(body.provider, {
        key,
        system: "Reply with exactly OK.",
        userPrompt: "ping",
        model: resolveModel(body.provider, body.model ?? ""),
        maxTokens: 8,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unexpected error";
      return badRequest(message);
    }
    return ok({ ok: true } as const);
  });
}
