import { z } from "zod";
import { PIPELINE_STEPS } from "@offeros/core";
import type { FieldClassifyOutput } from "@offeros/llm";
import { getDb } from "@/server/db/client";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { buildPipelineContext } from "@/server/pipeline/route-context";
import { buildFillProfile } from "@/server/services/fill-service";
import {
  answerQuestionsOf,
  CANONICAL_FIELDS,
  eligibleForFallback,
  resolveMappings,
} from "@/server/services/field-classify-service";
import { handle, ok, notFound, badRequest } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// A form the deterministic engine failed on can be large; the cap is here so a
// single call cannot turn a hostile page into an unbounded prompt.
const MAX_FIELDS = 60;

const bodySchema = z.object({
  fields: z
    .array(
      z.object({
        fieldId: z.string().min(1),
        label: z.string(),
        type: z.string(),
        options: z.array(z.string()).max(60).optional(),
        currentStatus: z.string(),
        required: z.boolean().optional(),
        /** Visible text near a field the label chain could not name. Capped
         *  here because it is scraped page text going into a prompt: the fence
         *  handles what it says, this handles how much of it there is. */
        contextText: z.string().max(400).optional(),
      }),
    )
    .min(1)
    .max(MAX_FIELDS),
});

/**
 * Ask a model what the fields the deterministic engine could not read are
 * asking for, then resolve its answer into something fillable.
 *
 * User-triggered only: nothing here runs as part of an ordinary fill. The
 * panel's button carries the spend mark because this is the one step in the
 * fill path that costs the user money.
 */
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    const task = getPipelineTask(db, id);
    if (!task) return notFound("agent task");
    if (task.status !== "awaiting_user" || PIPELINE_STEPS[task.step]?.key !== "fill-form") {
      return badRequest("task is not awaiting fill");
    }

    const body = bodySchema.parse(await request.json());
    // Only fields the engine gave up on. Sending a field it already classified
    // would invite the model to overrule a deterministic answer, which is
    // exactly backwards: the vocabulary is right when it fires, it just does
    // not fire often enough.
    const fields = body.fields.filter(eligibleForFallback);
    if (fields.length === 0) {
      return ok({ resolutions: [], classified: 0, considered: 0 });
    }

    const profile = buildFillProfile(db, task.applicationId);
    const output = (await buildPipelineContext(id).runLlm("field-classify", {
      fields,
      canonicalFields: CANONICAL_FIELDS,
      answerQuestions: answerQuestionsOf(profile),
    })) as FieldClassifyOutput;

    const resolutions = resolveMappings(output.mappings, fields, profile);
    return ok({
      resolutions,
      considered: fields.length,
      classified: resolutions.filter((r) => r.status !== "unknown").length,
    });
  });
}
