import type { JobIdentity } from "../../job-url";
import { safeFetch } from "../../net/safe-fetch";
import { htmlToText } from "../generic";
import type { Evidence, JobFields, VendorAdapter, VendorDeps } from "../types";
import { boardFromHtml, uuidFromUrl } from "./shared";

/**
 * Lever, through its public postings API.
 *
 * Endpoint and field names were read off a live board rather than recalled:
 * `api.lever.co/v0/postings/<board>/<id>?mode=json` answers with `text` for
 * the title, a `categories` object for location and commitment, and both HTML
 * and plain-text bodies. The plain one is used, because it is the one their
 * own site renders from.
 */

const API = "https://api.lever.co/v0/postings";

/** jobs.lever.co/<board>/<uuid> — and the EU host, which is the same board
 *  namespace on a different domain. */
function fromPlatformUrl(rawUrl: string): JobIdentity | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!/(^|\.)lever\.co$/.test(host)) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const board = parts[0];
  const jobId = parts[1];
  if (!board || !jobId || !UUID.test(jobId)) return null;
  return { vendor: "lever", board: board.toLowerCase(), jobId };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The board name as it appears when a company embeds Lever in its own site. */
const EMBED = [
  /jobs\.(?:eu\.)?lever\.co\/([A-Za-z0-9_-]+)/i,
  /api\.lever\.co\/v0\/postings\/([A-Za-z0-9_-]+)/i,
];

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** `{ min, max, currency, interval }` as one short line. */
function formatRange(range: unknown): string {
  if (typeof range !== "object" || range === null) return "";
  const r = range as { min?: unknown; max?: unknown; currency?: unknown; interval?: unknown };
  const min = typeof r.min === "number" ? r.min : undefined;
  const max = typeof r.max === "number" ? r.max : undefined;
  if (min === undefined && max === undefined) return "";
  const amount =
    min !== undefined && max !== undefined
      ? `${min.toLocaleString()}–${max.toLocaleString()}`
      : (min ?? max)!.toLocaleString();
  const period = str(r.interval)
    .replace(/^per-|-salary$/g, "")
    .replace(/-/g, " ");
  return [str(r.currency), amount, period ? `per ${period}` : ""].filter(Boolean).join(" ").trim();
}

export const leverAdapter: VendorAdapter = {
  vendor: "lever",

  fromUrl: fromPlatformUrl,

  fromHtml(html, pageUrl) {
    const jobId = uuidFromUrl(pageUrl);
    if (!jobId) return null;
    const board = boardFromHtml(html, EMBED);
    return board ? { vendor: "lever", board, jobId } : null;
  },

  async fetchJob(identity: JobIdentity, deps: VendorDeps): Promise<Evidence | null> {
    const url = `${API}/${encodeURIComponent(identity.board)}/${encodeURIComponent(identity.jobId)}?mode=json`;
    const result = await safeFetch(url, {
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.resolve ? { resolve: deps.resolve } : {}),
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    if (!result.ok || result.response.status >= 400) return null;

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(new TextDecoder().decode(result.bytes)) as Record<string, unknown>;
    } catch {
      return null;
    }
    const title = str(payload.text);
    if (!title) return null;

    const categories = (payload.categories ?? {}) as Record<string, unknown>;
    const fields: JobFields = { title };
    const location = str(categories.location);
    if (location) fields.location = location;
    // Body plus the "additional" block their own page shows beneath it.
    const body = [str(payload.descriptionPlain), str(payload.additionalPlain)]
      .filter(Boolean)
      .join("\n\n");
    const text = body || htmlToText(str(payload.description));
    if (text) fields.jdText = text;
    // The structured range, not `salaryDescriptionPlain` — that field is a
    // 480-character legal paragraph about geographic adjustment on the live
    // posting this was checked against, which is prose to read, not a value to
    // show. Same lesson as elsewhere in this codebase: a field written for a
    // reader is not a field.
    const salary = formatRange(payload.salaryRange);
    if (salary) fields.salary = salary;
    const createdAt = typeof payload.createdAt === "number" ? payload.createdAt : null;
    if (createdAt) fields.postedAt = new Date(createdAt).toISOString();

    return { source: "vendor-api", vendor: "lever", identity, fields };
  },
};
