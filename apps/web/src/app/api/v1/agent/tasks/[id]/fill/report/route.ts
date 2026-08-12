import { z } from "zod";
import { fieldReportSchema } from "@offeros/core";
import { getDb } from "@/server/db/client";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { applyFillReport, isCurrentClaim } from "@/server/services/fill-service";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const reportBodySchema = z.object({
  reports: z.array(fieldReportSchema),
  complete: z.boolean().optional(),
  /** The ticket the reporting panel holds. Optional — an older panel does not
   *  send it — and used only to tell that panel whether it is still the current
   *  claimer, never to refuse its report. */
  handoffId: z.string().optional(),
});

/** Fold a batch of per-field fill reports into the task. */
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!getPipelineTask(db, id)) return notFound("agent task");
    const { reports, complete, handoffId } = reportBodySchema.parse(await request.json());
    const task = applyFillReport(db, id, reports, complete ?? false);
    // The report always lands: two panels reporting is a nuisance, but throwing
    // away work the user actually did on the page would be worse than either.
    const staleClaim = handoffId !== undefined && !isCurrentClaim(db, id, handoffId);
    return ok({ ...task, staleClaim });
  });
}
