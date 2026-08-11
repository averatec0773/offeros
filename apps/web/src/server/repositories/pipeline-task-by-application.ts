import { desc, eq } from "drizzle-orm";
import type { PipelineTask } from "@offeros/core";
import type { Db } from "../db/client";
import { pipelineTasks } from "../db/schema";
import { toDomain } from "./pipeline-task-repo";

/** Looks up the most recent agent task for an application in one query,
 *  avoiding the N+1 pattern of listing all tasks and filtering in memory. */
export function getPipelineTaskByApplicationId(db: Db, applicationId: string): PipelineTask | null {
  const row = db
    .select()
    .from(pipelineTasks)
    .where(eq(pipelineTasks.applicationId, applicationId))
    .orderBy(desc(pipelineTasks.updatedAt))
    .limit(1)
    .get();
  return row ? toDomain(row) : null;
}

/**
 * Newest task per application, for the pages that render many applications at
 * once. `listPipelineTasks` is newest-first, so a naive Map build keeps the OLDEST
 * — which is how the console once reported a superseded run, nondeterministically
 * when two shared a timestamp.
 */
export function newestTaskByApplication(tasks: PipelineTask[]): Map<string, PipelineTask> {
  const byApplication = new Map<string, PipelineTask>();
  for (const task of tasks) {
    if (!byApplication.has(task.applicationId)) byApplication.set(task.applicationId, task);
  }
  return byApplication;
}
