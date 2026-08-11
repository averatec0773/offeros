import { getDb } from "@/server/db/client";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { buildPipelineContext } from "@/server/pipeline/route-context";
import { runTargetedStep } from "@/server/pipeline/runner";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Run the tailor-resume step out of band for a task parked at the fill or
 *  submit gate — the panel's in-place "Tailor résumé for this job". Produces
 *  (or versions) the resume artifact; the task's fill state is untouched.
 *  ServiceError (wrong task state) maps to a 400 envelope; a missing provider
 *  key maps to 42000 like every other generation route. */
export async function POST(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getPipelineTask(getDb(), id)) return notFound("agent task");
    return ok(await runTargetedStep(buildPipelineContext(id), "tailor-resume"));
  });
}
