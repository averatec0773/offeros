import { existsSync, readFileSync } from "node:fs";
import { getDb } from "@/server/db/client";
import { getResumeFile } from "@/server/services/resume-service";
import { handle, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Build a Content-Disposition header from a stored file name. Strips control
 *  characters (defense in depth — the Headers API already rejects raw CRLF),
 *  escapes quotes for the ASCII fallback, and adds an RFC 5987 UTF-8 variant
 *  so non-ASCII names (e.g. "Résumé.pdf") survive intact. */
function contentDisposition(name: string): string {
  const safe = Array.from(name)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join("");
  const ascii = safe.replace(/"/g, '\\"');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

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
        "content-disposition": contentDisposition(file.name),
        "content-length": String(bytes.byteLength),
      },
    });
  });
}
