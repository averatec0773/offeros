import { getDb } from "@/server/db/client";
import { getAgentTask } from "@/server/repositories/agent-task-repo";
import { buildPipelineContext } from "@/server/pipeline/route-context";
import { advance } from "@/server/pipeline/runner";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getAgentTask(getDb(), id)) return notFound("agent task");
    return ok(await advance(buildPipelineContext(id)));
  });
}
