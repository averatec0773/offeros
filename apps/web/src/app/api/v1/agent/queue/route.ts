import { z } from "zod";
import { getDb } from "@/server/db/client";
import { startQueue, queueStatus } from "@/server/services/queue-service";
import { buildPipelineContext } from "@/server/pipeline/route-context";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

const startBodySchema = z.object({
  applicationIds: z.array(z.string().min(1)).min(1).max(100),
});

/** Current run-queue status. */
export async function GET() {
  return handle(async () => ok(queueStatus()));
}

/** Enqueue eligible applications and start (or resume) the run loop. Door
 *  checks refuse ineligible items with per-application reasons. */
export async function POST(request: Request) {
  return handle(async () => {
    const { applicationIds } = startBodySchema.parse(await request.json());
    return ok(startQueue(getDb(), applicationIds, { ctxFor: buildPipelineContext }));
  });
}
