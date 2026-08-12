import { z } from "zod";
import { getDb } from "@/server/db/client";
import { getApplication, updateApplication } from "@/server/repositories/application-repo";
import { appendEvent } from "@/server/repositories/application-event-repo";
import { handle, ok, notFound, badRequest } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Enough to be a posting; short enough that a mis-click cannot store a novel. */
const MIN_CHARS = 200;
const MAX_CHARS = 40000;

const bodySchema = z.object({
  jdText: z.string().min(MIN_CHARS).max(MAX_CHARS),
});

/**
 * The description as the BROWSER sees it.
 *
 * Reserved rung four of the extraction ladder, finally used. A server fetch of
 * a page built entirely in JavaScript comes back with a link-preview blurb and
 * nothing else — 150 characters where the posting is thousands — because the
 * description does not exist until a browser runs the page. The panel is
 * already standing in that browser, looking at the rendered text.
 *
 * Overwrites by design: the user pressed a button on the page they are reading,
 * which is a clearer statement of intent than any heuristic could be. What was
 * replaced goes on the timeline, as with every other way of replacing a
 * description.
 */
export async function POST(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    const application = getApplication(db, id);
    if (!application) return notFound("application");

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return badRequest("that page did not have enough text to be a job description");
    }
    const jdText = parsed.data.jdText.trim();
    const previous = application.jdText?.trim() ?? "";
    if (previous === jdText) return ok(application);

    updateApplication(db, id, { jdText, jdSource: "browser" });
    if (previous !== "") {
      appendEvent(db, {
        applicationId: id,
        kind: "jd-replaced",
        payload: {
          previousChars: previous.length,
          previousPreview: previous.slice(0, 280),
          source: "browser",
        },
      });
    }
    return ok(getApplication(db, id));
  });
}
