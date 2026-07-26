import { getDb } from "@/server/db/client";
import { getApplication } from "@/server/repositories/application-repo";
import { getAgentTaskByApplicationId } from "@/server/repositories/agent-task-by-application";
import { getFit } from "@/server/repositories/fit-repo";
import { computeFit } from "@/server/services/fit-service";
import { buildPipelineContext } from "@/server/pipeline/route-context";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Recompute the applicant↔job fit for this application and return the row. */
export async function POST(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!getApplication(db, id)) return notFound("application");
    const task = getAgentTaskByApplicationId(db, id);
    const runLlm = buildPipelineContext(task?.id ?? id).runLlm;
    return ok(await computeFit(db, id, { runLlm }));
  });
}

/** The current stored fit for this application, or notFound if none yet. */
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const found = getFit(getDb(), id);
    return found ? ok(found) : notFound("fit analysis");
  });
}
