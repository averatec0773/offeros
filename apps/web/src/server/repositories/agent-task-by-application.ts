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
