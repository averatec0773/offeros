import { ARTIFACT_KINDS, type ArtifactKind, type JobInfo } from "@offeros/core";
import { getDb } from "@/server/db/client";
import { getPipelineTask } from "@/server/repositories/pipeline-task-repo";
import { getApplication } from "@/server/repositories/application-repo";
import { getArtifact } from "@/server/repositories/artifact-repo";
import { exportArtifactPdf } from "@/server/services/export-service";
import { badRequest, handle, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; kind: string }> };

const KIND_LABEL: Record<ArtifactKind, string> = {
  resume: "Resume",
  "cover-letter": "Cover_Letter",
};

/** Collapse to filesystem-safe ASCII words; empty → undefined. */
function slug(value: string | undefined): string | undefined {
  const cleaned = (value ?? "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  return cleaned === "" ? undefined : cleaned;
}

/** `Company_Position_Cover_Letter_YYYY-MM-DD.pdf`, mirroring the manual convention. */
function buildFilename(kind: ArtifactKind, job: JobInfo | undefined): string {
  const date = new Date().toISOString().slice(0, 10);
  const parts = [slug(job?.companyName), slug(job?.jobTitle), KIND_LABEL[kind], date].filter(
    (p): p is string => Boolean(p),
  );
  return `${parts.join("_")}.pdf`;
}

/** Stream a rendered PDF for a task artifact; errors are enveloped JSON. */
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id, kind } = await ctx.params;
    if (!(ARTIFACT_KINDS as readonly string[]).includes(kind)) {
      return badRequest(`unknown artifact kind: ${kind}`);
    }
    const artifactKind = kind as ArtifactKind;

    const db = getDb();
    const task = getPipelineTask(db, id);
    if (!task) return notFound("agent task");
    if (!getArtifact(db, id, artifactKind)) return notFound(`${kind} artifact`);

    const result = await exportArtifactPdf(db, id, artifactKind);
    if (!result.ok) {
      const message = result.logExcerpt ? `${result.error}\n\n${result.logExcerpt}` : result.error;
      return badRequest(message);
    }

    const job = getApplication(db, task.applicationId)?.jobInfo;
    const filename = buildFilename(artifactKind, job);
    const headers: Record<string, string> = {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-length": String(result.pdf.byteLength),
    };
    // Surface a non-fatal render remark (e.g. the builtin-fallback reason).
    if (result.note) headers["x-offeros-render-note"] = result.note;
    return new Response(new Uint8Array(result.pdf), { status: 200, headers });
  });
}
