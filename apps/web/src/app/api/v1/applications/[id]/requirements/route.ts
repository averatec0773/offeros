import { getDb } from "@/server/db/client";
import { buildRequirements } from "@/server/services/requirements-service";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** What this application's form asks, and how much of it we can already
 *  answer. Deterministic: no model runs behind this. */
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const summary = buildRequirements(getDb(), id);
    return summary ? ok(summary) : notFound("application");
  });
}
