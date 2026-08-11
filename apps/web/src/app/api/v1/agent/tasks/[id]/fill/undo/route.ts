import { getDb } from "@/server/db/client";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { undoSubmitted } from "@/server/services/fill-service";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Undo a terminal mark-as-submitted: restore the task to its pre-completion
 *  gate and the application to its pre-applied status (from the completion
 *  event's payload). ServiceError → 400 via the envelope handler. */
export async function POST(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!getPipelineTask(db, id)) return notFound("agent task");
    return ok(undoSubmitted(db, id));
  });
}
