import { z } from "zod";
import { getDb } from "@/server/db/client";
import { saveEvidence, EvidenceError } from "@/server/services/evidence-service";
import { handle, ok, badRequest } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const evidenceBodySchema = z.object({
  label: z.string().optional(),
  dataUrl: z.string().min(1),
});

/** Store one incident-field screenshot for this application. The extension is
 *  the only intended caller; the service validates the payload is a real PNG
 *  and refuses oversized images. */
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = evidenceBodySchema.parse(await request.json());
    try {
      return ok(saveEvidence(getDb(), id, body));
    } catch (error) {
      if (error instanceof EvidenceError) return badRequest(error.message);
      throw error;
    }
  });
}
