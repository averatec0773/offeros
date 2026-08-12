import { z } from "zod";
import { jobInfoSchema } from "@offeros/core";
import { getDb } from "@/server/db/client";
import { createApplication } from "@/server/repositories/application-repo";
import { createPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { reconInBackground } from "@/server/services/recon-service";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

/**
 * Two ways to create a task: the original `{ applicationId }` path (an
 * application already exists), or a normalized JD payload that creates the
 * application (with `jdText`) and the task in one call — the pluggable
 * JD-source seam. `source` is recorded on the request but not persisted yet.
 */
const byApplicationSchema = z.object({ applicationId: z.string().min(1) });
const byJdSchema = z.object({
  jobInfo: jobInfoSchema,
  jdText: z.string().optional(),
  source: z.string().optional(),
});
const createSchema = z.union([byApplicationSchema, byJdSchema]);

export async function POST(request: Request) {
  return handle(async () => {
    const input = createSchema.parse(await request.json());
    const db = getDb();
    const applicationId =
      "applicationId" in input
        ? input.applicationId
        : createApplication(db, { jobInfo: input.jobInfo, jdText: input.jdText }).id;
    const task = createPipelineTask(db, { applicationId });
    // A job added from the browser panel gets the same check on arrival that
    // one added by pasting a link does — it just runs behind the response.
    if (!("applicationId" in input)) reconInBackground(db, applicationId);
    return ok(task);
  });
}
