import { eq } from "drizzle-orm";
import { jdAnalysisSchema, type JdAnalysis } from "@offeros/core";
import type { Db } from "../db/client";
import { jdAnalyses } from "../db/schema";

export function getJdAnalysis(db: Db, applicationId: string): JdAnalysis | null {
  const row = db.select().from(jdAnalyses).where(eq(jdAnalyses.applicationId, applicationId)).get();
  return row ? jdAnalysisSchema.parse(row.doc) : null;
}

/** Upserts keyed by applicationId (one analysis per application): delete then insert. */
export function saveJdAnalysis(db: Db, analysis: JdAnalysis): JdAnalysis {
  const doc = jdAnalysisSchema.parse(analysis);
  db.delete(jdAnalyses).where(eq(jdAnalyses.applicationId, doc.applicationId)).run();
  db.insert(jdAnalyses)
    .values({
      id: doc.id,
      applicationId: doc.applicationId,
      doc,
      createdAt: doc.createdAt,
    })
    .run();
  return doc;
}
