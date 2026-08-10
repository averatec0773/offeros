import { z } from "zod";
import { CAMPAIGN_STATUSES } from "@offeros/core";
import { getDb } from "@/server/db/client";
import { deleteCampaign, getCampaign, updateCampaign } from "@/server/repositories/campaign-repo";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const campaign = getCampaign(getDb(), id);
    return campaign ? ok(campaign) : notFound("campaign");
  });
}

const patchBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  note: z.string().optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
});

export async function PATCH(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const patch = patchBodySchema.parse(await request.json());
    const updated = updateCampaign(getDb(), id, patch);
    return updated ? ok(updated) : notFound("campaign");
  });
}

/** Deleting a campaign detaches its members (repo guarantee) — the
 *  applications themselves are never touched beyond clearing the grouping. */
export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    return deleteCampaign(getDb(), id) ? ok({ deleted: true }) : notFound("campaign");
  });
}
