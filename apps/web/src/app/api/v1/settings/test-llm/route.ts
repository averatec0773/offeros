import { z, ZodError } from "zod";
import { callProvider } from "@offeros/llm";
import { getDb } from "@/server/db/client";
import { getSettings } from "@/server/repositories/settings-repo";
import { envApiKeyFor } from "@/server/pipeline/context";
import { badRequest, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

const bodySchema = z.object({
  provider: z.enum(["anthropic", "openai"]),
  model: z.string().optional(),
  key: z.string().optional(),
});

/**
 * Fires a one-line ping through the real provider transport so the settings
 * UI can report live connectivity. Deliberately does NOT go through `handle()`:
 * every failure here — including an unconfigured key — is a plain 400 with the
 * provider's own message, never the 42000 no-key envelope. This route IS the
 * settings surface a user reaches for after seeing "no key" elsewhere.
 */
export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const settings = getSettings(getDb());
    const key = body.key || settings.llm.apiKeys[body.provider] || envApiKeyFor(body.provider);
    await callProvider(body.provider, {
      key,
      system: "Reply with exactly OK.",
      userPrompt: "ping",
      model: body.model,
      maxTokens: 8,
    });
    return ok({ ok: true } as const);
  } catch (error) {
    if (error instanceof ZodError) return badRequest("validation failed", error.issues);
    if (error instanceof SyntaxError) return badRequest("malformed JSON body");
    const message = error instanceof Error ? error.message : "unexpected error";
    return badRequest(message);
  }
}
