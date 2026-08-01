import { z } from "zod";
import { APPLICATION_STATUSES, ATTACH_RESUME_OPTIONS } from "@offeros/core";
import { getDb } from "@/server/db/client";
import { getApplication, updateApplication } from "@/server/repositories/application-repo";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  notes: z.string().optional(),
  jdText: z.string().optional(),
  resumeId: z.string().optional(),
  attachResume: z.enum(ATTACH_RESUME_OPTIONS).optional(),
  appliedAt: z.number().optional(),
});

export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const found = getApplication(getDb(), id);
    return found ? ok(found) : notFound("application");
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const patch = patchSchema.parse(await request.json());
    const updated = updateApplication(getDb(), id, patch);
    return updated ? ok(updated) : notFound("application");
  });
}
