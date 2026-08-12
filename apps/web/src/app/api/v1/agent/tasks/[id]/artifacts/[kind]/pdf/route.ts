import { ARTIFACT_KINDS, type ArtifactKind } from "@offeros/core";
import { getDb } from "@/server/db/client";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { getArtifact } from "@/server/repositories/artifact-repo";
import { exportArtifactPdf } from "@/server/services/export-service";
import { nameOf } from "@/server/services/document-service";
import { badRequest, handle, notFound } from "@/server/http/envelope";
import { attachmentDisposition } from "@/server/http/content-disposition";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; kind: string }> };

/** Stream a rendered PDF for a task artifact; errors are enveloped JSON. */
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id, kind } = await ctx.params;
    if (!(ARTIFACT_KINDS as readonly string[]).includes(kind)) {
      return badRequest(`unknown artifact kind: ${kind}`);
    }
    const artifactKind = kind as ArtifactKind;

    const db = getDb();
    if (!getPipelineTask(db, id)) return notFound("agent task");
    const artifact = getArtifact(db, id, artifactKind);
    if (!artifact) return notFound(`${kind} artifact`);

    const result = await exportArtifactPdf(db, id, artifactKind);
    if (!result.ok) {
      const message = result.logExcerpt ? `${result.error}\n\n${result.logExcerpt}` : result.error;
      return badRequest(message);
    }

    // The download is named what the user calls the document — the default
    // ("cover_Acme_2026-08-12") when they have not renamed it. Files that
    // arrive on disk with a name nobody recognises are the reason names exist.
    const headers: Record<string, string> = {
      "content-type": "application/pdf",
      "content-disposition": attachmentDisposition(`${nameOf(db, artifact)}.pdf`),
      "content-length": String(result.pdf.byteLength),
    };
    // Surface a non-fatal render remark (e.g. the builtin-fallback reason).
    if (result.note) headers["x-offeros-render-note"] = result.note;
    return new Response(new Uint8Array(result.pdf), { status: 200, headers });
  });
}
