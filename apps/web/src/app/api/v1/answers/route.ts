import { z } from "zod";
import { getDb } from "@/server/db/client";
import { listAnswers, createAnswer } from "@/server/repositories/answer-repo";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

const createSchema = z.object({
  questionPatterns: z.array(z.string().min(1)).min(1),
  answer: z.string(),
  type: z.enum(["enum", "text", "number", "boolean"]),
  category: z.enum(["eeo", "screening", "custom"]),
});

export async function GET() {
  return handle(() => ok(listAnswers(getDb())));
}

export async function POST(request: Request) {
  return handle(async () => {
    const input = createSchema.parse(await request.json());
    return ok(createAnswer(getDb(), input));
  });
}
