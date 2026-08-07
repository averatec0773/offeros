import { z } from "zod";
import { jobInfoSchema } from "@offeros/core";
import { getDb } from "@/server/db/client";
import { startInstantFill } from "@/server/services/fill-service";
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
    return ok(startInstantFill(getDb(), body));
  });
}
