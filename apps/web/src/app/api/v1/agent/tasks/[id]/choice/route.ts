import { z } from "zod";
import { getDb } from "@/server/db/client";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { buildPipelineContext } from "@/server/pipeline/route-context";
import { choose } from "@/server/pipeline/runner";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const choiceSchema = z.object({ choice: z.enum(["skip", "generate"]) });

export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getPipelineTask(getDb(), id)) return notFound("agent task");
    const { choice } = choiceSchema.parse(await request.json());
    return ok(await choose(buildPipelineContext(id), choice));
  });
}
