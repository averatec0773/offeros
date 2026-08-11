import { z } from "zod";
import { getDb } from "@/server/db/client";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { buildPipelineContext } from "@/server/pipeline/route-context";
import { choose } from "@/server/pipeline/runner";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const choiceSchema = z.object({ choice: z.enum(["skip", "generate"]) });

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
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getPipelineTask(getDb(), id)) return notFound("agent task");
    const { choice } = choiceSchema.parse(await request.json());
    return ok(await choose(buildPipelineContext(id), choice));
  });
}
