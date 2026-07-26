import { settingsSchema, type Settings } from "@offeros/core";
import { getDb } from "@/server/db/client";
import { getSettings, saveSettings } from "@/server/repositories/settings-repo";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

/** Raw keys must never leave the server — strip them from any settings response. */
function withoutApiKeys(settings: Settings) {
  const { apiKeys: _apiKeys, ...llmRest } = settings.llm;
  return { ...settings, llm: llmRest };
}

export async function GET() {
  return handle(() => ok(withoutApiKeys(getSettings(getDb()))));
}

export async function PUT(request: Request) {
  return handle(async () => {
    const db = getDb();
    const body = settingsSchema.parse(await request.json());
    // Keys are only ever written through /settings/llm-keys — a full-object
    // PUT here can never clobber (or exfiltrate) the stored apiKeys.
    const stored = getSettings(db);
    const next: Settings = { ...body, llm: { ...body.llm, apiKeys: stored.llm.apiKeys } };
    return ok(withoutApiKeys(saveSettings(db, next)));
  });
}
