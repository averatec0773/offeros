import { z } from "zod";
import { getDb } from "@/server/db/client";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { resolveFill } from "@/server/services/fill-service";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const resolveBodySchema = z.object({
  action: z.enum(["fixed", "applied-manually"]),
  /** Which button was pressed. Recorded on the timeline entry so a submission
   *  can say where it came from; defaults to the panel, the older caller. */
  source: z.enum(["panel", "web-card"]).optional(),
});

/** Resolve an Action-Required task: user fixed the fields, or applied manually. */
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!getPipelineTask(db, id)) return notFound("agent task");
    const { action, source } = resolveBodySchema.parse(await request.json());
    return ok(resolveFill(db, id, action, source ?? "panel"));
  });
}
