import { getDb } from "@/server/db/client";
import { getApplication } from "@/server/repositories/application-repo";
import { getJdAnalysis } from "@/server/repositories/jd-analysis-repo";
import { getPipelineTaskByApplicationId } from "@/server/repositories/pipeline-task-by-application";
import { buildPipelineContext } from "@/server/pipeline/route-context";
import { analyzeJd, JdAnalysisError } from "@/server/services/jd-analysis-service";
import { handle, ok, badRequest, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** The stored reading of this posting, if one has been paid for. */
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const found = getJdAnalysis(getDb(), id);
    return found ? ok(found) : notFound("jd analysis");
  });
}

/**
 * Read this posting with the model, and keep the result.
 *
 * One call, one button, the user's own key — never automatic. A task is not
 * required: an analysis belongs to the application, and the task id only ever
 * served to wire up the provider.
 */
export async function POST(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!getApplication(db, id)) return notFound("application");
    const task = getPipelineTaskByApplicationId(db, id);
    try {
      return ok(await analyzeJd(db, id, { runLlm: buildPipelineContext(task?.id ?? id).runLlm }));
    } catch (error) {
      // "There is nothing to read yet" is the caller's problem to fix, not a
      // server fault — the card offers paste and the posting check for it.
      if (error instanceof JdAnalysisError) return badRequest(error.message);
      throw error;
    }
  });
}
