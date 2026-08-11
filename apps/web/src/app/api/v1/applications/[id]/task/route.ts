import { getDb } from "@/server/db/client";
import { getApplication } from "@/server/repositories/application-repo";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { listArtifacts } from "@/server/repositories/artifact-repo";
import { ensureGenerationTask } from "@/server/services/fill-service";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The generation task for this application, created on demand.
 *
 * The application page is the user's view and it has no notion of tasks — but
 * generating a résumé still runs a pipeline step, and a step needs one. This
 * is where that gap is closed, so the page can go straight to the same
 * targeted endpoints the browser panel uses.
 */
export async function POST(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!getApplication(db, id)) return notFound("application");
    const taskId = ensureGenerationTask(db, id);
    return ok({
      taskId,
      task: getPipelineTask(db, taskId),
      artifacts: listArtifacts(db, taskId),
    });
  });
}
