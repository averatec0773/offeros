import { z } from "zod";
import { getDb } from "@/server/db/client";
import { deleteTemplate, listTemplates, saveTemplate } from "@/server/services/template-service";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const putSchema = z.object({
  name: z.string().min(1),
  kind: z.string().min(1),
  renderer: z.string().min(1),
  content: z.string(),
  scaffoldHints: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export async function PUT(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!listTemplates(db).some((t) => t.id === id)) return notFound("template");
    const input = putSchema.parse(await request.json());
    return ok(saveTemplate(db, { ...input, id }));
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!listTemplates(db).some((t) => t.id === id)) return notFound("template");
    deleteTemplate(db, id);
    return ok({ id });
  });
}
