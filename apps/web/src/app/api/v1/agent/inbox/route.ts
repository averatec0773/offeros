import { getDb } from "@/server/db/client";
import { buildInbox } from "@/server/services/attention-service";
import { listRecentTrace } from "@/server/repositories/agent-trace-repo";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The campaign console's payload: what needs the user, and what the agent has
 *  been doing lately, across every application. */
export async function GET() {
  return handle(async () => {
    const db = getDb();
    return ok({ inbox: buildInbox(db), trace: listRecentTrace(db, 40) });
  });
}
