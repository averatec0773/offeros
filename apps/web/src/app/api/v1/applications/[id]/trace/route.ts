import { getDb } from "@/server/db/client";
import { getApplication } from "@/server/repositories/application-repo";
import { listTrace } from "@/server/repositories/agent-trace-repo";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** The agent's tool-call trace for this application: what it tried, whether
 *  the change was verified, and why it stopped. The human timeline stays
 *  `/events`; this is the machine one. */
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!getApplication(db, id)) return notFound("application");
    return ok(listTrace(db, id));
  });
}
