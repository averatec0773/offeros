import { getDb } from "@/server/db/client";
import { getPipelineTask, updatePipelineTask } from "@/server/repositories/pipeline-task-repo";
import { handle, ok, notFound, badRequest } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** A task can only be paused while it is in flight or waiting — pausing a `done`
 *  or `failed` task is meaningless and must not overwrite a terminal status. */
const PAUSABLE_STATUSES = new Set(["running", "queued", "awaiting_user"]);

/**
 * DEPRECATED — no client calls this.
 *
 * It drove the seven-step pipeline UI that the application page used to be:
 * Start, then approve each gate in turn. That shape is gone. The page is a
 * record now, and the things it does reach for these instead:
 *
 *   - generate / re-generate → POST /agent/tasks/[id]/{tailor,cover-letter}
 *   - revise                 → POST /agent/tasks/[id]/tweak
 *   - accept a document      → POST /agent/tasks/[id]/artifacts/[kind]/approve
 *   - fill the form          → POST /agent/tasks/[id]/fill/handoff
 *   - "I applied"            → the status control on the application, or
 *                              POST /agent/tasks/[id]/fill/resolve
 *
 * Kept for one release so a stale tab or an older extension build does not hit
 * a 404 mid-flight. Delete with the next breaking change; the runner functions
 * behind it stay either way, because the generation steps still run.
 */
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
