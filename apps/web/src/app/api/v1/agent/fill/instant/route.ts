import { z } from "zod";
import { jobInfoSchema } from "@offeros/core";
import { getDb } from "@/server/db/client";
import { startInstantFill } from "@/server/services/fill-service";
import { reconInBackground } from "@/server/services/recon-service";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

const bodySchema = z.object({
  jobInfo: jobInfoSchema,
  jdText: z.string().optional(),
});

/** One-click instant fill from the extension: create-or-reuse the application
 *  and a fill-gate task for this page, open a ticket, claim it, and return the
 *  bundle — the panel starts filling immediately. ServiceError (no URL, or the
 *  application is mid-pipeline) maps to a 400 envelope. */
export async function POST(request: Request) {
  return handle(async () => {
    const body = bodySchema.parse(await request.json());
    const db = getDb();
    const bundle = startInstantFill(db, body);
    // Same check the paste-a-link path runs on arrival, behind the response:
    // filling starts now, the description and the verdict catch up.
    reconInBackground(db, bundle.applicationId);
    return ok(bundle);
  });
}
