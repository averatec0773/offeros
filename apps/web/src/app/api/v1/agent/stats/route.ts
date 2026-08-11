import { computeFillStats } from "@offeros/autofill";
import { getDb } from "@/server/db/client";
import { listApplications } from "@/server/repositories/application-repo";
import { listPipelineTasks } from "@/server/repositories/pipeline-task-repo";
import { newestTaskByApplication } from "@/server/repositories/pipeline-task-by-application";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

/**
 * How the fill engine is doing, across everything.
 *
 * Computed on read rather than stored: the inputs are already persisted per
 * application, the arithmetic is trivial at this scale, and a stored aggregate
 * is one more thing that can quietly disagree with its source.
 */
export async function GET() {
  return handle(async () => {
    const db = getDb();
    const byApplication = newestTaskByApplication(listPipelineTasks(db));
    const applications = listApplications(db).map((application) => ({
      applyLink: application.jobInfo.applyLink,
      fields: byApplication.get(application.id)?.fieldReports ?? [],
    }));
    return ok(computeFillStats(applications));
  });
}
