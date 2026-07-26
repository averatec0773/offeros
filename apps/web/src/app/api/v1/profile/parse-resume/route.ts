import { z } from "zod";
import type { ParsedResume } from "@offeros/llm";
import { buildPipelineContext } from "@/server/pipeline/route-context";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

const bodySchema = z.object({ resumeText: z.string().min(1) });

/**
 * Run the `resume-parse` LLM task over raw résumé text and return the
 * proposed profile — no writes. `buildPipelineContext` doesn't need a real
 * agent task for this: its `runLlm` only reads settings for provider wiring,
 * so a fixed placeholder id is safe here (same seam pipeline routes use, so
 * tests inject a fake provider via `__setTestPipelineOverride`).
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { resumeText } = bodySchema.parse(await request.json());
    const output = (await buildPipelineContext("profile-parse-resume").runLlm("resume-parse", {
      resumeText,
    })) as ParsedResume;
    return ok(output);
  });
}
