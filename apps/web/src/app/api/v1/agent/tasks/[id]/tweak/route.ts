import { z } from "zod";
import { getDb } from "@/server/db/client";
import { getAgentTask } from "@/server/repositories/agent-task-repo";
import { buildPipelineContext } from "@/server/pipeline/route-context";
import { tweakArtifact } from "@/server/pipeline/tweak";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const tweakSchema = z.object({
  kind: z.enum(["resume", "cover-letter"]),
  instruction: z.string().min(1),
});

export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!getAgentTask(getDb(), id)) return notFound("agent task");
    const { kind, instruction } = tweakSchema.parse(await request.json());
    return ok(await tweakArtifact(buildPipelineContext(id), kind, instruction));
  });
}
