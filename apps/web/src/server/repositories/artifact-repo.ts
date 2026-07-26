import { and, eq } from "drizzle-orm";
import { artifactSchema, type Artifact, type ArtifactKind } from "@offeros/core";
import type { Db } from "../db/client";
import { artifacts } from "../db/schema";

export function getArtifact(db: Db, taskId: string, kind: ArtifactKind): Artifact | null {
  const row = db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.taskId, taskId), eq(artifacts.kind, kind)))
    .get();
  return row ? artifactSchema.parse(row.doc) : null;
}

export function listArtifacts(db: Db, taskId: string): Artifact[] {
  return db
    .select()
    .from(artifacts)
    .where(eq(artifacts.taskId, taskId))
    .all()
    .map((row) => artifactSchema.parse(row.doc));
}

/** Upserts keyed by artifact id. */
export function upsertArtifact(db: Db, artifact: Artifact): Artifact {
  const doc = artifactSchema.parse(artifact);
  db.insert(artifacts)
    .values({
      id: doc.id,
      taskId: doc.taskId,
      kind: doc.kind,
      doc,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    })
    .onConflictDoUpdate({
      target: artifacts.id,
      set: { taskId: doc.taskId, kind: doc.kind, doc, updatedAt: doc.updatedAt },
    })
    .run();
  return doc;
}
