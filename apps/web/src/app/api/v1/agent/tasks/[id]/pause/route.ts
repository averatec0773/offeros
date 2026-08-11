import { getDb } from "@/server/db/client";
import { getPipelineTask, updatePipelineTask } from "@/server/repositories/pipeline-task-repo";
import { handle, ok, notFound, badRequest } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** A task can only be paused while it is in flight or waiting — pausing a `done`
 *  or `failed` task is meaningless and must not overwrite a terminal status. */
const PAUSABLE_STATUSES = new Set(["running", "queued", "awaiting_user"]);

/** Pause is a simple status write; resume is the existing start/advance. */
export async function POST(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    const task = getPipelineTask(db, id);
    if (!task) return notFound("agent task");
    if (!PAUSABLE_STATUSES.has(task.status)) {
      return badRequest(`cannot pause a ${task.status} task`);
    }
    const updated = updatePipelineTask(db, id, { status: "paused" });
    return updated ? ok(updated) : notFound("agent task");
  });
}
