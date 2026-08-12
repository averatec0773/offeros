import { getDb } from "@/server/db/client";
import { getApplication } from "@/server/repositories/application-repo";
import { markSubmitted, undoSubmittedForApplication } from "@/server/services/fill-service";
import { handle, ok, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * "I submitted this application."
 *
 * The one door for the web app's own entry points — the status dropdown and
 * anything else that wants to record a submission without a fill task in
 * flight. Everything that makes a submission a submission happens inside
 * `markSubmitted`; this route only names the application and the source.
 */
export async function POST(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!getApplication(db, id)) return notFound("application");
    markSubmitted(db, id, "web-status");
    return ok(getApplication(db, id));
  });
}

/** Take it back. Restores the application, and its task if it has one. */
export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    if (!getApplication(db, id)) return notFound("application");
    undoSubmittedForApplication(db, id);
    return ok(getApplication(db, id));
  });
}
