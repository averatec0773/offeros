import { randomUUID } from "node:crypto";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { chatMessages } from "../db/schema";

/**
 * Row access for agent conversation threads. See the schema comment for the
 * scope model (one thread per application + one "global"); this module only
 * appends and windows — no summarisation, no retrieval. The long-term memory
 * this deliberately is NOT lives in the rest of the database, reachable
 * through the agent's tools.
 */

export const GLOBAL_SCOPE = "global";

export interface ChatMessage {
  id: string;
  scope: string;
  role: "user" | "assistant";
  content: string;
  steps?: unknown[];
  at: number;
}

export function appendChatMessage(
  db: Db,
  input: { scope: string; role: "user" | "assistant"; content: string; steps?: unknown[] },
): ChatMessage {
  const row: ChatMessage = {
    id: randomUUID(),
    scope: input.scope,
    role: input.role,
    content: input.content,
    ...(input.steps ? { steps: input.steps } : {}),
    at: Date.now(),
  };
  db.insert(chatMessages)
    .values({ ...row, steps: row.steps ?? null })
    .run();
  return row;
}

/**
 * The sliding window: the most recent `limit` messages of a thread, oldest
 * first (prompt order). Two messages in the same millisecond keep insertion
 * order via rowid — same tie-break pattern as the event log.
 */
export function listRecentMessages(db: Db, scope: string, limit = 10): ChatMessage[] {
  const rows = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.scope, scope))
    .orderBy(desc(chatMessages.at), desc(sql`rowid`))
    .limit(limit)
    .all();
  return rows.reverse().map((row) => ({
    id: row.id,
    scope: row.scope,
    role: row.role as "user" | "assistant",
    content: row.content,
    ...(row.steps ? { steps: row.steps } : {}),
    at: row.at,
  }));
}

/** Full thread, oldest first — the UI's mount-time load. */
export function listThread(db: Db, scope: string): ChatMessage[] {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.scope, scope))
    .orderBy(asc(chatMessages.at), asc(sql`rowid`))
    .all()
    .map((row) => ({
      id: row.id,
      scope: row.scope,
      role: row.role as "user" | "assistant",
      content: row.content,
      ...(row.steps ? { steps: row.steps } : {}),
      at: row.at,
    }));
}
