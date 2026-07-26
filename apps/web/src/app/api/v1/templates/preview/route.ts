import { z } from "zod";
import { getDb } from "@/server/db/client";
import { previewTemplate } from "@/server/services/export-service";
import { badRequest, handle } from "@/server/http/envelope";

export const runtime = "nodejs";

const previewSchema = z.union([
  z
    .object({
      content: z.string().min(1),
      renderer: z.string().min(1),
      scaffoldHints: z.string().optional(),
    })
    .strict(),
  z.object({ id: z.string().min(1) }).strict(),
]);

/** Render a (possibly unsaved) template to a preview PDF; errors are enveloped JSON. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = previewSchema.parse(await request.json());
    const result = await previewTemplate(getDb(), input);
    if (!result.ok) {
      const message = result.logExcerpt ? `${result.error}\n\n${result.logExcerpt}` : result.error;
      return badRequest(message);
    }

    const headers: Record<string, string> = {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="Template_Preview.pdf"`,
      "content-length": String(result.pdf.byteLength),
    };
    if (result.note) headers["x-offeros-render-note"] = result.note;
    return new Response(new Uint8Array(result.pdf), { status: 200, headers });
  });
}
