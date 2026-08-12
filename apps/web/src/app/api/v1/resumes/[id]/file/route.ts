import { existsSync, readFileSync } from "node:fs";
import { getDb } from "@/server/db/client";
import { getResumeFile } from "@/server/services/resume-service";
import { handle, notFound } from "@/server/http/envelope";
import { attachmentDisposition } from "@/server/http/content-disposition";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Stream a stored résumé's bytes; errors are enveloped JSON. */
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const file = getResumeFile(getDb(), id);
    if (!file) return notFound("resume");
    if (!existsSync(file.filePath)) return notFound("resume");

    const bytes = readFileSync(file.filePath);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": file.mimeType,
        "content-disposition": attachmentDisposition(file.name),
        "content-length": String(bytes.byteLength),
      },
    });
  });
}
