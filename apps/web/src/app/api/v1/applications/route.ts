import { getDb } from "@/server/db/client";
import { listApplicationsByJobUrl } from "@/server/repositories/application-repo";
import { handle, ok, badRequest } from "@/server/http/envelope";

export const runtime = "nodejs";

/**
 * Dedup probe for the extension's Add-this-job flow: which applications
 * already track this exact posting URL?
 *
 * This file used to be a full list+create CRUD surface, but nothing ever
 * called it — creation goes through POST /agent/tasks (application + task in
 * one step) and lists are read server-side by the pages. An entry point with
 * no caller is untested attack surface, so only the branch with a real
 * client remains, and the parameter it exists for is now required.
 */
export async function GET(request: Request) {
  return handle(() => {
    const jobUrl = new URL(request.url).searchParams.get("jobUrl");
    if (!jobUrl) return badRequest("jobUrl is required");
    return ok(listApplicationsByJobUrl(getDb(), jobUrl));
  });
}
