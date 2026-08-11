import { randomUUID } from "node:crypto";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { fillIncidents, formShapes } from "../db/schema";

/**
 * Row access for the two tables that remember what the fill engine has met:
 * `form_shapes` (every question, ever) and `fill_incidents` (the fills worth
 * looking at).
 *
 * Deliberately dumb. Nothing here decides anything — the decision of what
 * counts as an incident lives in `@offeros/autofill`'s triggers.ts, where it is
 * pure and testable without a database. This module only writes down what that
 * decision was.
 */

export interface ShapeSighting {
  questionKey: string;
  /** The question as the form asked it — for a person reading the table. */
  question: string;
  classifiedType: string;
  /** True when this sighting was a failure the engine could have prevented.
   *  Guard refusals and manual uploads are NOT failures; the caller has
   *  already applied that distinction. */
  failed: boolean;
}

/**
 * Fold one fill's questions into the shape table.
 *
 * Upsert rather than insert-or-select: two fills finishing at once would
 * otherwise race between the read and the write, and one of them would lose its
 * count. The counters increment against the stored row inside the statement, so
 * neither fill has to have read it first.
 *
 * `first_failed_application_id` is written once and never overwritten
 * (`COALESCE`), because its whole job is to answer "did this fail somewhere
 * ELSE" — a value that moved with each new failure could never answer that.
 */
export function recordShapes(
  db: Db,
  vendor: string,
  applicationId: string,
  sightings: ShapeSighting[],
  now: number,
): void {
  for (const sighting of sightings) {
    db.insert(formShapes)
      .values({
        questionKey: sighting.questionKey,
        vendor,
        question: sighting.question,
        classifiedType: sighting.classifiedType,
        seenCount: 1,
        failedCount: sighting.failed ? 1 : 0,
        firstFailedApplicationId: sighting.failed ? applicationId : null,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: formShapes.questionKey,
        set: {
          seenCount: sql`${formShapes.seenCount} + 1`,
          failedCount: sql`${formShapes.failedCount} + ${sighting.failed ? 1 : 0}`,
          firstFailedApplicationId: sighting.failed
            ? sql`COALESCE(${formShapes.firstFailedApplicationId}, ${applicationId})`
            : sql`${formShapes.firstFailedApplicationId}`,
          // The question text and classified type follow the latest sighting:
          // if the engine's classifier improves, the row should say what it
          // thinks NOW, not what it thought the first time.
          question: sighting.question,
          classifiedType: sighting.classifiedType,
          lastSeenAt: now,
        },
      })
      .run();
  }
}

export interface KnownShapes {
  /** Every question key recorded before this fill. */
  seen: Set<string>;
  /** Keys that have already failed on some OTHER application. */
  failedElsewhere: Set<string>;
}

/**
 * What was known about these questions BEFORE the current fill.
 *
 * Scoped to the keys on this page rather than loading the whole table: the
 * table grows without limit across a job search, and every fill would otherwise
 * pay for questions it will never ask about.
 */
export function knownShapes(db: Db, keys: string[], applicationId: string): KnownShapes {
  const seen = new Set<string>();
  const failedElsewhere = new Set<string>();
  if (keys.length === 0) return { seen, failedElsewhere };

  for (const row of db
    .select()
    .from(formShapes)
    .where(inArray(formShapes.questionKey, keys))
    .all()) {
    seen.add(row.questionKey);
    if (row.failedCount > 0 && row.firstFailedApplicationId !== applicationId) {
      failedElsewhere.add(row.questionKey);
    }
  }
  return { seen, failedElsewhere };
}

export interface FillIncidentRow {
  id: string;
  applicationId: string;
  taskId: string;
  vendor: string;
  formFingerprint: string;
  triggerId: string;
  questionKeys: string[];
  summary: string;
  /** "open" until something acts on it. Nothing acts on it yet — the status
   *  column exists so the later steps of the plan (a rule proposer, a
   *  promotion engine) have somewhere to record that they did. */
  status: string;
  at: number;
}

export function recordIncident(
  db: Db,
  incident: Omit<FillIncidentRow, "id" | "status" | "at">,
  now: number,
): FillIncidentRow {
  const row: FillIncidentRow = { ...incident, id: randomUUID(), status: "open", at: now };
  db.insert(fillIncidents).values(row).run();
  return row;
}

export interface FormMemorySummary {
  /** Distinct questions the engine has ever met. */
  knownQuestions: number;
  /** How many of those it has met more than once — the number that decides
   *  whether learning per-question is worth anything at all. A question seen
   *  once and never again cannot be learned from usefully. */
  recurringQuestions: number;
  /** Questions with at least one preventable failure behind them. */
  failedQuestions: number;
  incidents: { triggerId: string; count: number }[];
  totalIncidents: number;
  /** Where fills break down, by the kind of question and the ATS it was on —
   *  the "aim the next fix here" list. Highest failure count first. */
  failuresByType: FieldTypeFailure[];
}

export interface FieldTypeFailure {
  vendor: string;
  classifiedType: string;
  /** Distinct questions of this (type, vendor) the engine has met. */
  seen: number;
  /** How many of those have failed at least once. */
  failed: number;
}

/** Aggregate counts, computed in SQL rather than by loading the tables: this
 *  runs on a page render and both tables grow for the life of the job search. */
export function formMemorySummary(db: Db): FormMemorySummary {
  const shapes = db
    .select({
      known: sql<number>`count(*)`,
      recurring: sql<number>`sum(case when ${formShapes.seenCount} > 1 then 1 else 0 end)`,
      failed: sql<number>`sum(case when ${formShapes.failedCount} > 0 then 1 else 0 end)`,
    })
    .from(formShapes)
    .get();

  const incidents = db
    .select({ triggerId: fillIncidents.triggerId, count: sql<number>`count(*)` })
    .from(fillIncidents)
    .groupBy(fillIncidents.triggerId)
    .all()
    .sort((a, b) => b.count - a.count);

  // Which (question type, vendor) pairs actually break — the substrate for
  // "aim the next fix here" rather than adding another vendor blind. Only pairs
  // with a failure are returned; ordered by failure count, then fail rate.
  const failuresByType = db
    .select({
      vendor: formShapes.vendor,
      classifiedType: formShapes.classifiedType,
      seen: sql<number>`count(*)`,
      failed: sql<number>`sum(case when ${formShapes.failedCount} > 0 then 1 else 0 end)`,
    })
    .from(formShapes)
    .groupBy(formShapes.vendor, formShapes.classifiedType)
    .having(sql`sum(case when ${formShapes.failedCount} > 0 then 1 else 0 end) > 0`)
    .all()
    .sort((a, b) => b.failed - a.failed || b.failed / b.seen - a.failed / a.seen);

  return {
    knownQuestions: shapes?.known ?? 0,
    recurringQuestions: shapes?.recurring ?? 0,
    failedQuestions: shapes?.failed ?? 0,
    incidents,
    totalIncidents: incidents.reduce((sum, row) => sum + row.count, 0),
    failuresByType,
  };
}

/** Incidents, newest first. `applicationId` narrows to one application. */
export function listIncidents(db: Db, applicationId?: string): FillIncidentRow[] {
  const query = db.select().from(fillIncidents);
  const rows = applicationId
    ? query
        .where(eq(fillIncidents.applicationId, applicationId))
        .orderBy(desc(fillIncidents.at))
        .all()
    : query.orderBy(desc(fillIncidents.at)).all();
  return rows.map((row) => ({ ...row, questionKeys: row.questionKeys ?? [] }));
}
