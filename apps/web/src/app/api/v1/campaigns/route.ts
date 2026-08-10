import { z } from "zod";
import { getDb } from "@/server/db/client";
import { createCampaign, listCampaigns } from "@/server/repositories/campaign-repo";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

export async function GET() {
  return handle(() => ok(listCampaigns(getDb())));
}

const createBodySchema = z.object({
  name: z.string().trim().min(1),
  note: z.string().optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const body = createBodySchema.parse(await request.json());
    return ok(createCampaign(getDb(), body));
  });
}
