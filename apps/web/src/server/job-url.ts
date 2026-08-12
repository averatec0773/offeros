/**
 * When two links are the same job.
 *
 * This is the whole of "have I already added this?", and it used to be one
 * line: origin + pathname, with the query string thrown away as tracking
 * noise. That was wrong in a way that lost people's work. Some job boards put
 * the job's identity IN the query string — a board's embedded application form
 * is `…/embed/job_app?for=<board>&token=<jobId>`, where the path is byte-for-
 * byte identical for every job on earth. Dropping the query collapsed every
 * such posting into one, so adding a second one was reported as a duplicate
 * and the user was sent to an unrelated job they had saved weeks earlier,
 * believing they had just added a new one.
 *
 * The inversion that fixes it: strip the tracking parameters we KNOW are
 * tracking, and keep everything else. An unknown parameter is far more likely
 * to be an identifier than a tracker, and the cost of the two mistakes is not
 * symmetric — keeping a tracker means one job listed twice, which the user can
 * see and fix; dropping an identifier means a job silently never saved.
 */

/** Exact parameter names that only ever carry attribution. */
const TRACKING_PARAMS = new Set([
  "gh_src",
  "ref",
  "referrer",
  "source",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "msclkid",
  "trk",
  "trackingid",
]);

/** Whole families, matched by prefix (`utm_source`, `utm_campaign`, …). */
const TRACKING_PREFIXES = ["utm_"];

function isTracking(key: string): boolean {
  const lower = key.toLowerCase();
  return TRACKING_PARAMS.has(lower) || TRACKING_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * A link reduced to what identifies the job.
 *
 * Host lowercased, trailing slash dropped, hash dropped, tracking parameters
 * removed, and whatever survives sorted by key — so the same link shared with
 * its parameters in a different order still matches itself. An unparsable
 * string falls back to comparing exactly, which is what it did before.
 */
export function normalizeJobUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const kept = [...parsed.searchParams.entries()]
    .filter(([key]) => !isTracking(key))
    .sort(([a, aValue], [b, bValue]) => a.localeCompare(b) || aValue.localeCompare(bValue));
  const query = kept.map(([key, value]) => `${key}=${value}`).join("&");
  const base = parsed.origin.toLowerCase() + parsed.pathname.replace(/\/$/, "");
  return query ? `${base}?${query}` : base;
}

/**
 * The job a board link points at, when we can read it — board plus job id.
 *
 * One board publishes the same posting two ways: `/<board>/jobs/<id>` and the
 * embedded form's `?for=<board>&token=<id>`. Normalisation alone cannot see
 * that those are one job, because they share neither path nor parameters.
 * Reading the identity out of both does.
 */
export interface JobIdentity {
  /**
   * Which platform this posting belongs to.
   *
   * A plain string, not a union of the platforms that happen to exist today.
   * It started as a literal and adding the second and third platform forced an
   * edit here — which is exactly the kind of change a new adapter is supposed
   * never to need. Widening it is the fix; the alternative was every vendor
   * touching a file that has nothing to do with it.
   */
  vendor: string;
  board: string;
  jobId: string;
}

export function parseGreenhouseUrl(rawUrl: string): { token: string; jobId: string } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!host.endsWith("greenhouse.io")) return null;

  // The embedded forms carry both ids in the query string instead of the path.
  // Two shapes, both real: the application form uses `token`, the board embed
  // uses `gh_jid` (the extension's own jobIdFromUrl reads the same pair).
  if (url.pathname.includes("/embed/")) {
    const token = url.searchParams.get("for");
    const jobId = url.searchParams.get("token") ?? url.searchParams.get("gh_jid");
    return token && jobId && /^\d+$/.test(jobId) ? { token, jobId } : null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const jobsAt = parts.indexOf("jobs");
  if (jobsAt === -1) return null;
  const jobId = parts[jobsAt + 1];
  if (!jobId || !/^\d+$/.test(jobId)) return null;

  // Shared board: /{token}/jobs/{id}. Company subdomain (acme.greenhouse.io):
  // the board token is the subdomain and the path starts at /jobs.
  const token = jobsAt > 0 ? parts[jobsAt - 1] : host.split(".")[0];
  if (!token || token === "boards" || token === "job-boards") return null;
  return { token, jobId };
}

/** The job identity a link resolves to, or null when we cannot read one. */
export function jobIdentity(url: string): JobIdentity | null {
  const greenhouse = parseGreenhouseUrl(url);
  if (greenhouse) {
    return {
      vendor: "greenhouse",
      board: greenhouse.token.toLowerCase(),
      jobId: greenhouse.jobId,
    };
  }
  return null;
}

/**
 * Are these two links the same job?
 *
 * Identity first, where both links have one — that is the only way the two
 * shapes of the same board posting are recognised as one. Otherwise the
 * normalised comparison, which is right for every path-based board (the other
 * supported platforms all put the job id in the path).
 */
export function isSameJobUrl(a: string, b: string): boolean {
  const left = jobIdentity(a);
  const right = jobIdentity(b);
  if (left && right) {
    return left.vendor === right.vendor && left.board === right.board && left.jobId === right.jobId;
  }
  // One resolvable and one not means they are not the same posting in any way
  // we can prove; fall through to the string comparison rather than guessing.
  return normalizeJobUrl(a) === normalizeJobUrl(b);
}
