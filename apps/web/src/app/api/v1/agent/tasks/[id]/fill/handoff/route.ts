import { getDb } from "@/server/db/client";
import { getAgentTask } from "@/server/repositories/agent-task-repo";
import { createHandoffForTask } from "@/server/services/fill-service";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Open a fill ticket for a task parked at the fill-form gate. */
export async function POST(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!getAgentTask(db, id)) return notFound("agent task");
    return ok(createHandoffForTask(db, id));
  });
}
