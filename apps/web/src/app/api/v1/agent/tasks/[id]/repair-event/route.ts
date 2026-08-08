import { z } from "zod";
import { getDb } from "@/server/db/client";
import { getAgentTask } from "@/server/repositories/agent-task-repo";
import { appendEvent } from "@/server/repositories/application-event-repo";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const repairEventSchema = z.object({
  kind: z.enum(["repair-attempted", "repair-succeeded", "repair-failed"]),
  payload: z
    .object({
      failure: z.string().max(60),
      action: z.string().max(120),
      detail: z.string().max(300).optional(),
    })
    .strict(),
});

/**
 * Ledger a self-recovery attempt from the panel. Kind is a closed enum and the
 * payload a fixed shape — this is a bookkeeping channel, not a general event
 * writer. Rides the normal append → timeline → SSE path, so every repair the
 * agent tries is visible as it happens.
 */
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    const task = getAgentTask(db, id);
    if (!task) return notFound("agent task");
    const body = repairEventSchema.parse(await request.json());
    appendEvent(db, { applicationId: task.applicationId, kind: body.kind, payload: body.payload });
    return ok({});
  });
}
