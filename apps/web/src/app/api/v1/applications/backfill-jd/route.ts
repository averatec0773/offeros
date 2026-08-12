import { getDb } from "@/server/db/client";
import { listApplications, updateApplication } from "@/server/repositories/application-repo";
import { extractJob } from "@/server/extract/ladder";
import { handle, ok } from "@/server/http/envelope";

export const runtime = "nodejs";

/**
 * Re-climb the ladder for applications that have no description.
 *
 * User-triggered, never automatic: this sends one or two requests per
 * application, and a tool that quietly fans out across every employer someone
 * has applied to is a different product. Re-runnable — anything that already
 * has a description is skipped, so a second pass only retries what failed.
 *
 * Reports per application, including why each failure failed. "Nine worked,
 * two did not, and here is why" is the useful answer; a bare count is not.
 */

/** A ceiling per run, so one click cannot become fifty outbound requests. */
const MAX_PER_RUN = 25;

export async function POST() {
  return handle(async () => {
    const db = getDb();
    const missing = listApplications(db)
      .filter((a) => !a.jdText?.trim() && a.jobInfo.applyLink?.trim())
      .slice(0, MAX_PER_RUN);

    const results: { id: string; job: string; ok: boolean; detail: string }[] = [];
    for (const application of missing) {
      const job = `${application.jobInfo.jobTitle} at ${application.jobInfo.companyName}`;
      const extracted = await extractJob(application.jobInfo.applyLink!).catch(() => null);
      const description = extracted?.fields.jdText?.trim();
      if (!extracted || !description) {
        const why =
          extracted?.attempts.filter((a) => !a.ok).at(-1)?.detail ?? "could not read the posting";
        results.push({ id: application.id, job, ok: false, detail: why });
        continue;
      }
      updateApplication(db, application.id, {
        jdText: description,
        jdSource: extracted.sources.jdText ?? "page",
      });
      results.push({
        id: application.id,
        job,
        ok: true,
        detail: `${description.length} characters from ${extracted.sources.jdText ?? "the page"}`,
      });
    }

    return ok({
      considered: missing.length,
      filled: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  });
}

/** How many applications a run would look at, so the button can say so
 *  before anyone presses it. */
export async function GET() {
  return handle(() => {
    const missing = listApplications(getDb()).filter(
      (a) => !a.jdText?.trim() && a.jobInfo.applyLink?.trim(),
    );
    return ok({ missing: missing.length, cap: MAX_PER_RUN });
  });
}
