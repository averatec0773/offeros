import { getDb } from "@/server/db/client";
import { GLOBAL_SCOPE, listThread } from "@/server/repositories/chat-repo";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

/** The full thread for a scope, oldest first — what a chat surface loads on
 *  mount so a conversation survives reloads and follows the user across
 *  surfaces. `applicationId` absent = the global console thread. */
export async function GET(request: Request) {
  return handle(() => {
    const applicationId = new URL(request.url).searchParams.get("applicationId");
    return ok(listThread(getDb(), applicationId || GLOBAL_SCOPE));
  });
}
