import { settingsSchema } from "@offeros/core";
import { getDb } from "@/server/db/client";
import { getSettings, saveSettings } from "@/server/repositories/settings-repo";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

export async function GET() {
  return handle(() => ok(getSettings(getDb())));
}

export async function PUT(request: Request) {
  return handle(async () => {
    const body = await request.json();
    return ok(saveSettings(getDb(), settingsSchema.parse(body)));
  });
}
