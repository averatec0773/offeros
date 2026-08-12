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
  /**
   * A revision the user typed ("shorter", "lead with the ML work"). Capped
   * because it goes into the prompt unfenced — it is the user's own words about
   * their own answer, and fencing it would tell the model to ignore the person
   * who asked. The cap is the whole of the protection that gives up, so it is a
   * small one: an instruction is a phrase, not a document.
   */
  instruction: z.string().max(500).optional(),
});

/**
 * Draft — or revise — a grounded answer to a single application question, using
 * the task's profile/JD/résumé as the fact base and the same provider wiring
 * the pipeline steps use.
 *
 * Revision is the same call with `existingAnswer` + `instruction`: one route,
 * one grounding assembly, one set of guards. A separate refine endpoint would
 * have been a second place for those three things to drift apart.
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
      instruction: body.instruction,
    })) as QuestionAnswerOutput;
    return ok({ answer: output.answer });
  });
}
