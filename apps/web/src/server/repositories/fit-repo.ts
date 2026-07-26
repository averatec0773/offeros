import { eq } from "drizzle-orm";
import { fitAnalysisSchema, type FitAnalysis } from "@offeros/core";
import type { Db } from "../db/client";
import { fitAnalyses } from "../db/schema";

export function getFit(db: Db, applicationId: string): FitAnalysis | null {
  const row = db
    .select()
    .from(fitAnalyses)
    .where(eq(fitAnalyses.applicationId, applicationId))
    .get();
  return row ? fitAnalysisSchema.parse(row.doc) : null;
}

/** All stored fit analyses (one per application that has been scored) — used
 * by the pipeline-home list to badge rows without an N+1 per-row lookup. */
export function listFits(db: Db): FitAnalysis[] {
  return db
    .select()
    .from(fitAnalyses)
    .all()
    .map((row) => fitAnalysisSchema.parse(row.doc));
}

/**
 * Upserts keyed by applicationId (one fit analysis per application): delete then
 * insert, wrapped in a transaction so the pair is atomic. Without it, a
 * concurrent `computeFit` could interleave between the delete and the insert and
 * race a primary-key violation on the reused id; better-sqlite3 is synchronous,
 * so the transaction serializes the pair into one indivisible step.
 */
export function saveFit(db: Db, fit: FitAnalysis): FitAnalysis {
  const doc = fitAnalysisSchema.parse(fit);
  db.transaction((tx) => {
    tx.delete(fitAnalyses).where(eq(fitAnalyses.applicationId, doc.applicationId)).run();
    tx.insert(fitAnalyses)
      .values({
        id: doc.id,
        applicationId: doc.applicationId,
        doc,
        updatedAt: Date.now(),
      })
      .run();
  });
  return doc;
}
