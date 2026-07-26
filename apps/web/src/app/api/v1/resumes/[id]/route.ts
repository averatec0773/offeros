import { z } from "zod";
import { getDb } from "@/server/db/client";
import { updateResume, deleteResume } from "@/server/services/resume-service";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().optional(),
  note: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const patch = patchSchema.parse(await request.json());
    const updated = updateResume(getDb(), id, patch);
    return updated ? ok(updated) : notFound("resume");
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const removed = deleteResume(getDb(), id);
    return removed ? ok({ id }) : notFound("resume");
  });
}
