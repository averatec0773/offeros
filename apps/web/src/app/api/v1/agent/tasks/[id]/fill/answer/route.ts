import { z } from "zod";
import type { QuestionAnswerOutput } from "@offeros/llm";
import { getDb } from "@/server/db/client";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { buildPipelineContext } from "@/server/pipeline/route-context";
import { buildQuestionContext } from "@/server/services/fill-service";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const answerBodySchema = z.object({
  question: z.string().min(1),
  label: z.string(),
  context: z.string().optional(),
  options: z.array(z.string().min(1)).max(50).optional(),
  existingAnswer: z.string().optional(),
});

/**
 * Draft a grounded answer to a single free-text application question, using the
 * task's profile/JD/résumé as the fact base and the same provider wiring the
 * pipeline steps use.
 */
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!getPipelineTask(db, id)) return notFound("agent task");
    const body = answerBodySchema.parse(await request.json());
    const grounding = buildQuestionContext(db, id);
    const output = (await buildPipelineContext(id).runLlm("question-answer", {
      ...grounding,
      question: body.question,
      label: body.label,
      context: body.context,
      options: body.options,
      existingAnswer: body.existingAnswer,
    })) as QuestionAnswerOutput;
    return ok({ answer: output.answer });
  });
}
