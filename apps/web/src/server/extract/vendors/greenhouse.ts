import { parseGreenhouseUrl, type JobIdentity } from "../../job-url";
import { fetchGreenhouse, greenhouseClosedMarker } from "../../services/recon/greenhouse";
import { htmlToText } from "../generic";
import type { Evidence, JobFields, VendorAdapter, VendorDeps } from "../types";

/**
 * A board whose postings are usually not on its own domain.
 *
 * This is the platform that broke the hostname-matching design, and it breaks
 * it in both directions: employers embed its jobs into their own careers page,
 * and its own links redirect to the employer's domain. So it has to be
 * recognisable from a page that never mentions the board in its URL — which
 * the embed script in the markup does say, plainly.
 *
 * The API call is not reimplemented here; it is the same `fetchGreenhouse`
 * reconnaissance already uses.
 */

/** The board's own embed script, which names the board it belongs to. */
const EMBED_SCRIPT =
  /(?:boards|job-boards)\.greenhouse\.io\/embed\/job_board\/js\?for=([A-Za-z0-9_-]+)/i;
/** Some pages only reference the API host, with the board in the path. */
const API_HOST = /boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/i;

/** The job id, when the page's own URL carries it in the query. */
function jobIdFromQuery(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    const id = url.searchParams.get("gh_jid") ?? url.searchParams.get("token");
    return id && /^\d+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export const greenhouseAdapter: VendorAdapter = {
  vendor: "greenhouse",

  fromUrl(url) {
    const parsed = parseGreenhouseUrl(url);
    return parsed
      ? { vendor: "greenhouse", board: parsed.token.toLowerCase(), jobId: parsed.jobId }
      : null;
  },

  /**
   * The case the old design could not see: a page on an employer's own domain,
   * whose URL carries the job id and whose markup names the board.
   */
  fromHtml(html, pageUrl) {
    const jobId = jobIdFromQuery(pageUrl);
    if (!jobId) return null;
    const board = EMBED_SCRIPT.exec(html)?.[1] ?? API_HOST.exec(html)?.[1];
    return board ? { vendor: "greenhouse", board: board.toLowerCase(), jobId } : null;
  },

  async fetchJob(identity: JobIdentity, deps: VendorDeps): Promise<Evidence | null> {
    const { job } = await fetchGreenhouse(
      identity.board,
      identity.jobId,
      deps.fetchImpl ?? fetch,
      deps.signal,
      deps.resolve,
    );
    if (!job) return null;

    const fields: JobFields = {};
    if (job.title) fields.title = job.title;
    if (job.company) fields.company = job.company;
    if (job.location) fields.location = job.location;
    const text = htmlToText(job.contentHtml);
    if (text) fields.jdText = text;

    return {
      source: "vendor-api",
      vendor: "greenhouse",
      identity,
      fields,
      questions: job.questions,
    };
  },

  closedMarker: greenhouseClosedMarker,
};
