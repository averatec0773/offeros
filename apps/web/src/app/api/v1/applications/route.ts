import { randomUUID } from "node:crypto";
import { getDb } from "@/server/db/client";
import {
  createApplication,
  listApplicationsByJobUrl,
} from "@/server/repositories/application-repo";
import { describeJobUrl, reconApplication } from "@/server/services/recon-service";
import { handle, ok, badRequest } from "@/server/http/envelope";

export const runtime = "nodejs";

/**
 * Dedup probe for the extension's Add-this-job flow: which applications
 * already track this exact posting URL?
 */
export async function GET(request: Request) {
  return handle(() => {
    const jobUrl = new URL(request.url).searchParams.get("jobUrl");
    if (!jobUrl) return badRequest("jobUrl is required");
    return ok(listApplicationsByJobUrl(getDb(), jobUrl));
  });
}

/**
 * Track a job from its link, and nothing else.
 *
 * Paste a URL, get an application. On a platform we can read, the title,
 * company and description come from the platform's own API — on anything else
 * the record is deliberately minimal, with a title the user can edit, because
 * a guessed company name is worse than a blank one.
 *
 * Adding the same posting twice returns the one that already exists rather
 * than a second copy, flagged so the caller can say so and go there.
 *
 * No model runs here. The reconnaissance that follows is the same
 * user-triggered check the application page offers, run once on arrival so the
 * requirements card has something to say immediately.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body: unknown = await request.json().catch(() => null);
    const raw = (body as { url?: unknown } | null)?.url;
    if (typeof raw !== "string" || raw.trim() === "") return badRequest("url is required");
    const url = raw.trim();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return badRequest("that does not look like a URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return badRequest("only http and https links can be tracked");
    }

    const db = getDb();
    const existing = listApplicationsByJobUrl(db, url)[0];
    if (existing) return ok({ application: existing, duplicate: true });

    const described = await describeJobUrl(url);
    const application = createApplication(db, {
      jobInfo: {
        jobId: randomUUID(),
        jobTitle: described?.title || "Untitled role",
        companyName: described?.company || parsed.hostname.replace(/^www\./, ""),
        applyLink: url,
        ...(described?.location ? { jobLocation: described.location } : {}),
      },
      ...(described?.jdText ? { jdText: described.jdText } : {}),
    });

    // One check on arrival: is it still open, and what will it ask? Failure is
    // not fatal — the application is already tracked, and the page offers the
    // same check on a button.
    const recon = await reconApplication(db, application.id).catch(() => null);
    return ok({ application, duplicate: false, ...(recon ? { recon } : {}) });
  });
}
