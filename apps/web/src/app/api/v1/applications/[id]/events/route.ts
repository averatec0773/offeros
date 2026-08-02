import { getDb } from "@/server/db/client";
import { getApplication } from "@/server/repositories/application-repo";
import { listEvents } from "@/server/repositories/application-event-repo";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** The bookkeeping timeline for an application, oldest first (same order as
 *  `listEvents`) — the client reverses it for display. */
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!getApplication(db, id)) return notFound("application");
    return ok(listEvents(db, id));
  });
}
