import { getDb } from "@/server/db/client";
import { getApplication } from "@/server/repositories/application-repo";
import { listOpenFillHandoffs } from "@/server/repositories/fill-handoff-repo";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

/** All open (pending/claimed) fill tickets, each carrying its job header. */
export async function GET() {
  return handle(() => {
    const db = getDb();
    const tickets = listOpenFillHandoffs(db).map((handoff) => {
      const application = getApplication(db, handoff.applicationId);
      return {
        ...handoff,
        job: {
          title: application?.jobInfo.jobTitle ?? "",
          company: application?.jobInfo.companyName ?? "",
          applyLink: application?.jobInfo.applyLink,
        },
      };
    });
    return ok(tickets);
  });
}
