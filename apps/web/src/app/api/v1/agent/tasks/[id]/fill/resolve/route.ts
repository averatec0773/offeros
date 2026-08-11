import { z } from "zod";
import { getDb } from "@/server/db/client";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { resolveFill } from "@/server/services/fill-service";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const resolveBodySchema = z.object({
  action: z.enum(["fixed", "applied-manually"]),
});

/** Resolve an Action-Required task: user fixed the fields, or applied manually. */
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!getPipelineTask(db, id)) return notFound("agent task");
    const { action } = resolveBodySchema.parse(await request.json());
    return ok(resolveFill(db, id, action));
  });
}
