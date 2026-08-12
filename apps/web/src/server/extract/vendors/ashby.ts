import type { JobIdentity } from "../../job-url";
import { safeFetch } from "../../net/safe-fetch";
import { htmlToText } from "../generic";
import type { Evidence, JobFields, VendorAdapter, VendorDeps } from "../types";
import { boardFromHtml, uuidFromUrl } from "./shared";

/**
 * Ashby, through its public job-board API.
 *
 * Read off a live board rather than recalled: the endpoint is board-level
 * (`api.ashbyhq.com/posting-api/job-board/<org>`), so one request returns every
 * posting and the one we want is found by id. Compensation only comes back
 * when asked for, which is why the query parameter is not optional here.
 */

const API = "https://api.ashbyhq.com/posting-api/job-board";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** jobs.ashbyhq.com/<org>/<uuid>, and company subdomains on the same host. */
function fromPlatformUrl(rawUrl: string): JobIdentity | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/(^|\.)ashbyhq\.com$/.test(url.hostname.toLowerCase())) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const board = parts[0];
  const jobId = parts.find((part) => UUID.test(part));
  if (!board || !jobId || board === jobId) return null;
  return { vendor: "ashby", board: board.toLowerCase(), jobId: jobId.toLowerCase() };
}

/** How an embedded Ashby board names itself in a company's own markup. */
const EMBED = [
  /jobs\.ashbyhq\.com\/([A-Za-z0-9_-]+)/i,
  /api\.ashbyhq\.com\/posting-api\/job-board\/([A-Za-z0-9_-]+)/i,
];

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export const ashbyAdapter: VendorAdapter = {
  vendor: "ashby",

  fromUrl: fromPlatformUrl,

  fromHtml(html, pageUrl) {
    const jobId = uuidFromUrl(pageUrl);
    if (!jobId) return null;
    const board = boardFromHtml(html, EMBED);
    return board ? { vendor: "ashby", board, jobId } : null;
  },

  async fetchJob(identity: JobIdentity, deps: VendorDeps): Promise<Evidence | null> {
    const url = `${API}/${encodeURIComponent(identity.board)}?includeCompensation=true`;
    const result = await safeFetch(url, {
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.resolve ? { resolve: deps.resolve } : {}),
      ...(deps.signal ? { signal: deps.signal } : {}),
      // A whole board is bigger than one posting — a couple of megabytes is
      // normal here, where it would be suspicious for a single page.
      maxBytes: 8 * 1024 * 1024,
    });
    if (!result.ok || result.response.status >= 400) return null;

    let payload: { jobs?: unknown };
    try {
      payload = JSON.parse(new TextDecoder().decode(result.bytes)) as { jobs?: unknown };
    } catch {
      return null;
    }
    const jobs = Array.isArray(payload.jobs) ? (payload.jobs as Record<string, unknown>[]) : [];
    const job = jobs.find((entry) => str(entry.id).toLowerCase() === identity.jobId);
    if (!job) return null;

    const title = str(job.title);
    if (!title) return null;

    const fields: JobFields = { title };
    const location = str(job.location);
    if (location) fields.location = location;
    const text = str(job.descriptionPlain) || htmlToText(str(job.descriptionHtml));
    if (text) fields.jdText = text;
    const published = str(job.publishedAt);
    if (published) fields.postedAt = published;
    const compensation = (job.compensation ?? {}) as Record<string, unknown>;
    const salary =
      str(compensation.compensationTierSummary) ||
      str(compensation.scrapeableCompensationSalarySummary);
    if (salary) fields.salary = salary;

    return { source: "vendor-api", vendor: "ashby", identity, fields };
  },
};
