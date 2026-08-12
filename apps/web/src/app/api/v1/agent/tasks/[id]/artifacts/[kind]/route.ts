import { ARTIFACT_KINDS, type ArtifactKind } from "@offeros/core";
import { getDb } from "@/server/db/client";
import { getArtifact } from "@/server/repositories/artifact-repo";
import { DocumentError, renameDocument } from "@/server/services/document-service";
import { badRequest, handle, notFound, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; kind: string }> };

/**
 * Rename one generated document.
 *
 * The whole endpoint, because a name is the only thing about an artifact a
 * person edits directly — its contents are produced and revised through the
 * pipeline, never typed here.
 */
export async function PATCH(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id, kind } = await ctx.params;
    if (!(ARTIFACT_KINDS as readonly string[]).includes(kind)) {
      return badRequest(`unknown artifact kind: ${kind}`);
    }
    const db = getDb();
    if (!getArtifact(db, id, kind as ArtifactKind)) return notFound(`${kind} artifact`);

    const body: unknown = await request.json();
    const name = (body as { name?: unknown } | null)?.name;
    try {
      const renamed = renameDocument(db, id, kind as ArtifactKind, name as string);
      return ok({ name: renamed.name });
    } catch (error) {
      // A rejected name is the user's typo, not a server fault.
      if (error instanceof DocumentError) return badRequest(error.message);
      throw error;
    }
  });
}
