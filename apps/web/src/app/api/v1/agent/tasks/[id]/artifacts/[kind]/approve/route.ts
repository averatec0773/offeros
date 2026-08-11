import { getDb } from "@/server/db/client";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { getArtifact } from "@/server/repositories/artifact-repo";
import { buildPipelineContext } from "@/server/pipeline/route-context";
import { approveArtifact } from "@/server/pipeline/runner";
import { handle, ok, badRequest, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; kind: string }> };

/**
 * Accept a generated résumé or cover letter.
 *
 * The application page has no step machine to advance, but accepting a
 * document still has to do what accepting one has always done: leave a
 * timeline event, and hand the revision history to style-memory distillation
 * so "they approved it after asking for it shorter twice" becomes a standing
 * preference. Both live in `approveArtifact`, which `advance()` also calls —
 * one implementation, so the learning path cannot be lost by one caller
 * forgetting it.
 */
export async function POST(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id, kind } = await ctx.params;
    if (kind !== "resume" && kind !== "cover-letter") {
      return badRequest('kind must be "resume" or "cover-letter"');
    }
    const db = getDb();
    const task = getPipelineTask(db, id);
    if (!task) return notFound("agent task");
    // Nothing to accept is a bad request, not a silent success — a UI that
    // thinks it approved something that does not exist would show the wrong
    // state until the next reload.
    if (!getArtifact(db, id, kind)) return notFound(`${kind} artifact`);

    approveArtifact(buildPipelineContext(id), task.applicationId, kind);
    return ok({ approved: true, kind });
  });
}
