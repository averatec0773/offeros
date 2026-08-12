import { z } from "zod";
import { PIPELINE_STEPS } from "@offeros/core";
import type { FieldAnalyzeOutput } from "@offeros/llm";
import { getDb } from "@/server/db/client";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { buildPipelineContext } from "@/server/pipeline/route-context";
import {
  eligibleForAnalysis,
  gatherSources,
  resolveAnalyses,
} from "@/server/services/field-analysis-service";
import { handle, ok, notFound, badRequest } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** A form the engine failed on can be long; the cap stops a hostile page from
 *  turning one press into an unbounded prompt. */
const MAX_FIELDS = 60;

const bodySchema = z.object({
  /** The ticket the asking panel holds. Recorded, not trusted. */
  handoffId: z.string().optional(),
  fields: z
    .array(
      z.object({
        fieldId: z.string().min(1),
        label: z.string(),
        type: z.string(),
        options: z.array(z.string()).max(60).optional(),
        required: z.boolean().optional(),
        sectionLabel: z.string().max(200).optional(),
        rowIndex: z.number().int().min(0).max(50).optional(),
        currentValue: z.string().max(2000).optional(),
      }),
    )
    .min(1)
    .max(MAX_FIELDS),
  /** The applicant's own words about one field, when they typed some. */
  instruction: z.string().max(500).optional(),
});

/**
 * Ask the agent to fill the fields the engine could not.
 *
 * The difference from the classifier this replaces is what the model can see:
 * the applicant's structured profile, their résumé, the job description, and
 * the answers they have given before. That is what makes "which of your
 * projects is most relevant here?" answerable at all.
 *
 * User-pressed only. One call, one billable action; the panel's button carries
 * the spend mark because this is the step that costs money.
 */
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    const task = getPipelineTask(db, id);
    if (!task) return notFound("agent task");
    const parkedAt = PIPELINE_STEPS[task.step]?.key;
    if (task.status !== "awaiting_user" || (parkedAt !== "fill-form" && parkedAt !== "submit")) {
      return badRequest("task is not awaiting fill");
    }

    const body = bodySchema.parse(await request.json());
    // A field the page already holds is not outstanding: analysing it would
    // spend a call to overwrite what the applicant already put there.
    const fields = body.fields.filter(eligibleForAnalysis);
    if (fields.length === 0) {
      return ok({ fields: [], summary: "Nothing outstanding to analyse." });
    }

    const sources = await gatherSources(db, task.applicationId);
    const output = (await buildPipelineContext(id).runLlm("field-analyze", {
      fields,
      sources,
      ...(body.instruction ? { instruction: body.instruction } : {}),
    })) as FieldAnalyzeOutput;

    const resolved = resolveAnalyses(output.fields, fields, sources);
    return ok({
      fields: resolved,
      summary: output.summary || `Looked at ${fields.length} field(s).`,
    });
  });
}
