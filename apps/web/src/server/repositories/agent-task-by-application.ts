import { desc, eq } from "drizzle-orm";
import type { AgentTask } from "@offeros/core";
import type { Db } from "../db/client";
import { agentTasks } from "../db/schema";
import { toDomain } from "./agent-task-repo";

/** Looks up the most recent agent task for an application in one query,
 *  avoiding the N+1 pattern of listing all tasks and filtering in memory. */
export function getAgentTaskByApplicationId(db: Db, applicationId: string): AgentTask | null {
  const row = db
    .select()
    .from(agentTasks)
    .where(eq(agentTasks.applicationId, applicationId))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(1)
    .get();
  return row ? toDomain(row) : null;
}

/**
 * Newest task per application, for the pages that render many applications at
 * once. `listAgentTasks` is newest-first, so a naive Map build keeps the OLDEST
 * — which is how the console once reported a superseded run, nondeterministically
 * when two shared a timestamp.
 */
export function newestTaskByApplication(tasks: AgentTask[]): Map<string, AgentTask> {
  const byApplication = new Map<string, AgentTask>();
  for (const task of tasks) {
    if (!byApplication.has(task.applicationId)) byApplication.set(task.applicationId, task);
  }
  return byApplication;
}
