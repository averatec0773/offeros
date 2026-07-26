import { z } from "zod";
import type { LlmProvider } from "@offeros/llm";
import { getDb } from "@/server/db/client";
import { getSettings, saveSettings } from "@/server/repositories/settings-repo";
import { envApiKeyFor } from "@/server/pipeline/context";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

type KeyStatus = "saved" | "env" | "none";

const PROVIDERS: LlmProvider[] = ["anthropic", "openai"];

function statusFor(provider: LlmProvider, apiKeys: Record<string, string>): KeyStatus {
  const saved = apiKeys[provider];
  if (saved && saved.trim() !== "") return "saved";
  if (envApiKeyFor(provider).trim() !== "") return "env";
  return "none";
}

function statusRecord(apiKeys: Record<string, string>): Record<LlmProvider, KeyStatus> {
  return Object.fromEntries(PROVIDERS.map((p) => [p, statusFor(p, apiKeys)])) as Record<
    LlmProvider,
    KeyStatus
  >;
}

/** Never a key, only its status: "saved" beats "env" beats "none". */
export async function GET() {
  return handle(() => {
    const settings = getSettings(getDb());
    return ok(statusRecord(settings.llm.apiKeys));
  });
}

const putSchema = z.object({
  provider: z.enum(["anthropic", "openai"]),
  key: z.string(),
});

/** Sets or clears (key === "") one provider's stored key; echoes only the status record. */
export async function PUT(request: Request) {
  return handle(async () => {
    const body = putSchema.parse(await request.json());
    const db = getDb();
    const settings = getSettings(db);
    const apiKeys = { ...settings.llm.apiKeys };
    const key = body.key.trim();
    if (key === "") delete apiKeys[body.provider];
    else apiKeys[body.provider] = key;
    saveSettings(db, { ...settings, llm: { ...settings.llm, apiKeys } });
    return ok(statusRecord(apiKeys));
  });
}
