import { readLogo } from "@/server/services/logo-service";
import { handle, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * A cached company logo, read from this machine.
 *
 * Read-only, and the path is built from a validated application id against a
 * fixed extension list rather than from anything in the request — see
 * logo-service. No logo is not an error worth dwelling on; the page falls back
 * to the letter avatar, which is the design's floor anyway.
 */
export async function GET(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const logo = readLogo(id);
    if (!logo) return notFound("logo");
    return new Response(logo.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": logo.mime,
        "content-length": String(logo.bytes.byteLength),
        // Local file, changes only when reconnaissance replaces it.
        "cache-control": "private, max-age=3600",
      },
    });
  });
}
