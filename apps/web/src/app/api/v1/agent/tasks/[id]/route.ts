import { z } from "zod";
import { AGENT_TASK_STATUSES, applicationInfoSchema, PIPELINE_STEPS } from "@offeros/core";
import { getDb } from "@/server/db/client";
import { getAgentTask, updateAgentTask } from "@/server/repositories/agent-task-repo";
import { getJdAnalysis } from "@/server/repositories/jd-analysis-repo";
import { listArtifacts } from "@/server/repositories/artifact-repo";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  status: z.enum(AGENT_TASK_STATUSES).optional(),
  step: z.number().int().min(0).max(PIPELINE_STEPS.length).optional(),
  applicationInfo: applicationInfoSchema.optional(),
  resumeId: z.string().optional(),
  coverLetterId: z.string().optional(),
});

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

export async function PATCH(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const patch = patchSchema.parse(await request.json());
    const updated = updateAgentTask(getDb(), id, patch);
    return updated ? ok(updated) : notFound("agent task");
  });
}
