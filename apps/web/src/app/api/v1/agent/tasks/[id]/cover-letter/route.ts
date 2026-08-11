import { getDb } from "@/server/db/client";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { buildPipelineContext } from "@/server/pipeline/route-context";
import { runTargetedStep } from "@/server/pipeline/runner";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Run the cover-letter step out of band for a task parked at the fill or
 *  submit gate — the panel's in-place "Write cover letter". Grounds on the
 *  tailored résumé artifact when one exists, else profile facts; produces (or
 *  versions) the cover-letter artifact without touching the fill state. */
export async function POST(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getPipelineTask(getDb(), id)) return notFound("agent task");
    return ok(await runTargetedStep(buildPipelineContext(id), "generate-cover-letter"));
  });
}
