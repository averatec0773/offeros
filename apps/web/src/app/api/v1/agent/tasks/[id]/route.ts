import { getDb } from "@/server/db/client";
import { getAgentTask } from "@/server/repositories/agent-task-repo";
import { getJdAnalysis } from "@/server/repositories/jd-analysis-repo";
import { listArtifacts } from "@/server/repositories/artifact-repo";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    const task = getAgentTask(db, id);
    if (!task) return notFound("agent task");
    return ok({
      task,
      jdAnalysis: getJdAnalysis(db, task.applicationId),
      artifacts: listArtifacts(db, id),
    });
  });
}
