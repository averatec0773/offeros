import { z } from "zod";
import { getDb } from "@/server/db/client";
import { listAnswers } from "@/server/repositories/answer-repo";
import { saveAnswer } from "@/server/services/answer-service";
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
    // Upsert, not insert: an answer to a question the bank already holds
    // updates that entry. Every surface posts here — the profile page, the
    // Equal Employment section, the panel accepting an answer mid-fill — and
    // duplicates were reaching the fill engine, where two entries for one
    // question mean whichever the matcher reached first wins.
    return ok(saveAnswer(getDb(), input));
  });
}
