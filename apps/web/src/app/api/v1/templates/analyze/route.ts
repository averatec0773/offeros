import { z } from "zod";
import { analyzeTemplate } from "@/server/services/template-service";
import { badRequest, handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

const analyzeSchema = z.object({
  content: z.string(),
  filename: z.string().optional(),
});

export async function POST(request: Request) {
  return handle(async () => {
    const input = analyzeSchema.parse(await request.json());
    if (input.content.trim() === "") return badRequest("content is required");
    return ok(analyzeTemplate(input.content));
  });
}
