import { getDb } from "@/server/db/client";
import { reconApplication } from "@/server/services/recon-service";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Check one posting: is it still up, and what will its form ask?
 *
 * User-triggered and per-application on purpose — there is no batch endpoint
 * and no scheduler behind this. The service never throws for a network
 * problem; an unreachable employer comes back as an honest `unknown` verdict
 * with a 200, because "we could not tell" is a result, not a server error.
 */
export async function POST(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    // Pressed by a person, so a description that comes back may replace one
    // already stored. Automatic checks never do.
    const result = await reconApplication(getDb(), id, { allowOverwrite: true });
    return result ? ok(result) : notFound("application");
  });
}
