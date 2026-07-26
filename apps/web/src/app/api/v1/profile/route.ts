import { profileSchema } from "@offeros/core";
import { getDb } from "@/server/db/client";
import { getProfile, saveProfile } from "@/server/repositories/profile-repo";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

export async function GET() {
  return handle(() => ok(getProfile(getDb())));
}

export async function PUT(request: Request) {
  return handle(async () => {
    const body = await request.json();
    return ok(saveProfile(getDb(), profileSchema.parse(body)));
  });
}
