import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { applicationEventSchema, type ApplicationEvent } from "@offeros/core";
import type { Db } from "../db/client";
import { applicationEvents } from "../db/schema";

export type AppendEventInput = {
  applicationId: string;
  kind: string;
  payload?: Record<string, unknown>;
};

/**
 * Append a bookkeeping event. Bookkeeping never breaks the host operation:
 * every failure here (bad db handle, a throwing insert, anything) is caught,
 * logged, and swallowed — this function NEVER throws. Callers append without
 * wrapping the call.
 */
export function appendEvent(db: Db, event: AppendEventInput): void {
  try {
    const doc = applicationEventSchema.parse({
      id: randomUUID(),
      applicationId: event.applicationId,
      kind: event.kind,
      at: Date.now(),
      payload: event.payload,
    });
    db.insert(applicationEvents)
      .values({
        id: doc.id,
        applicationId: doc.applicationId,
        kind: doc.kind,
        at: doc.at,
        payload: doc.payload,
      })
      .run();
  } catch (error) {
    console.error("[application-event-repo] appendEvent failed:", error);
  }
}

/** All events for an application, oldest first. `rowid` is the tie-breaker
 *  for events appended within the same millisecond (same pattern as
 *  fill-handoff-repo's `listOpenFillHandoffs`). */
export function listEvents(db: Db, applicationId: string): ApplicationEvent[] {
  return db
    .select()
    .from(applicationEvents)
    .where(eq(applicationEvents.applicationId, applicationId))
    .orderBy(asc(applicationEvents.at), asc(sql`rowid`))
    .all()
    .map((row) =>
      applicationEventSchema.parse({
        id: row.id,
        applicationId: row.applicationId,
        kind: row.kind,
        at: row.at,
        payload: row.payload ?? undefined,
      }),
    );
}
