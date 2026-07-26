import { getDb } from "@/server/db/client";
import { makePipelineContext, type PipelineContextOptions } from "./context";
import type { PipelineContext } from "./types";

/**
 * Test-only seam for the pipeline API routes. Routes always call
 * `buildPipelineContext(taskId)`, which defaults to the real `@offeros/llm`
 * provider (wired from settings, same as `makePipelineContext`'s own
 * default) — production code never branches on environment. Integration
 * tests that exercise the routes over a temp DB call
 * `__setTestPipelineOverride` once, before invoking any handler, to inject a
 * fake `runLlm`/`callProvider`/`steps` and avoid touching a real provider.
 */
let testOverride: PipelineContextOptions | null = null;

export function __setTestPipelineOverride(opts: PipelineContextOptions | null): void {
  testOverride = opts;
}

export function buildPipelineContext(taskId: string): PipelineContext {
  return makePipelineContext(getDb(), taskId, testOverride ?? {});
}
