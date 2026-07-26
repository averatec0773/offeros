import { getDb } from "@/server/db/client";
import { getFillHandoff } from "@/server/repositories/fill-handoff-repo";
import { claimHandoff } from "@/server/services/fill-service";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Claim a pending fill ticket, returning the bundle the extension fills from. */
export async function POST(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!getFillHandoff(db, id)) return notFound("fill handoff");
    return ok(claimHandoff(db, id));
  });
}
