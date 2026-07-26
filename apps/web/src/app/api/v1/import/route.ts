import { getDb } from "@/server/db/client";
import { importBundle } from "@/server/services/import-service";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handle(async () => ok(importBundle(getDb(), await request.json())));
}
