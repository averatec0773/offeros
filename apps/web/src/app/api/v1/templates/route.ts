import { z } from "zod";
import { getDb } from "@/server/db/client";
import { listTemplates, saveTemplate } from "@/server/services/template-service";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

const saveSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  kind: z.string().min(1),
  renderer: z.string().min(1),
  content: z.string(),
  scaffoldHints: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export async function GET() {
  return handle(() => ok(listTemplates(getDb())));
}

export async function POST(request: Request) {
  return handle(async () => {
    const input = saveSchema.parse(await request.json());
    return ok(saveTemplate(getDb(), input));
  });
}
