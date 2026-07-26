import { z } from "zod";
import { getDb } from "@/server/db/client";
import { updateAnswer, deleteAnswer } from "@/server/repositories/answer-repo";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const putSchema = z.object({
  questionPatterns: z.array(z.string().min(1)).min(1).optional(),
  answer: z.string().optional(),
  type: z.enum(["enum", "text", "number", "boolean"]).optional(),
  category: z.enum(["eeo", "screening", "custom"]).optional(),
});

export async function PUT(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const patch = putSchema.parse(await request.json());
    const updated = updateAnswer(getDb(), id, patch);
    return updated ? ok(updated) : notFound("answer");
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const removed = deleteAnswer(getDb(), id);
    return removed ? ok({ id }) : notFound("answer");
  });
}
