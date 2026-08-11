import { z } from "zod";
import { fieldReportSchema } from "@offeros/core";
import { getDb } from "@/server/db/client";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { applyFillReport } from "@/server/services/fill-service";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const reportBodySchema = z.object({
  reports: z.array(fieldReportSchema),
  complete: z.boolean().optional(),
});

/** Fold a batch of per-field fill reports into the task. */
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!getPipelineTask(db, id)) return notFound("agent task");
    const { reports, complete } = reportBodySchema.parse(await request.json());
    return ok(applyFillReport(db, id, reports, complete ?? false));
  });
}
