import { z } from "zod";
import { getDb } from "@/server/db/client";
import { assignToCampaign, getCampaign } from "@/server/repositories/campaign-repo";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

/**
 * One endpoint for both directions: `campaignId` moves the applications into
 * that campaign, `campaignId: null` moves them out of whichever they are in.
 * Symmetric on purpose — the list UI's "move to…" menu is one control, and two
 * asymmetric endpoints would force it to special-case "No campaign".
 */
const assignBodySchema = z.object({
  campaignId: z.string().nullable(),
  applicationIds: z.array(z.string().min(1)).min(1),
});

export async function POST(request: Request) {
  return handle(async () => {
    const db = getDb();
    const { campaignId, applicationIds } = assignBodySchema.parse(await request.json());
    if (campaignId !== null && !getCampaign(db, campaignId)) return notFound("campaign");
    return ok({ assigned: assignToCampaign(db, campaignId, applicationIds) });
  });
}
