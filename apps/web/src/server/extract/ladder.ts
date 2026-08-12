import { safeFetchText } from "../net/safe-fetch";
import type { JobIdentity } from "../job-url";
import { readPage } from "./generic";
import type {
  Evidence,
  ExtractedJob,
  JobFieldName,
  LadderAttempt,
  VendorAdapter,
  VendorDeps,
} from "./types";
import { SOURCE_RANK } from "./types";
import { VENDOR_ADAPTERS } from "./vendors";

/**
 * Climbing the evidence ladder for one posting.
 *
 * Nothing here knows which platforms exist. It asks every registered adapter
 * the same two questions — can you read this URL, can you read this page — and
 * whoever answers gets asked for the job. That is the whole reason this file
 * should not need editing when a platform is added.
 *
 * Budget: at most two outbound requests per extraction, and when the identity
 * is already known from the URL they go out together rather than in sequence.
 * The page is fetched EVEN THEN, deliberately: it is how a redirect to the
 * employer's domain is noticed, how a board is identified when the URL says
 * nothing, and where any structured data lives.
 *
 * A rung that fails never stops the climb. Each one records what happened, so
 * a run that found nothing can say what it tried instead of shrugging.
 */

export interface ExtractDeps extends VendorDeps {
  adapters?: VendorAdapter[];
  /** Skip the page fetch. Only for callers that already have the markup. */
  html?: string;
}

/** Later sources win, and a field only moves if the new one actually has it. */
function merge(into: ExtractedJob, evidence: Evidence): void {
  const rank = SOURCE_RANK[evidence.source];
  for (const [key, value] of Object.entries(evidence.fields) as [JobFieldName, string][]) {
    if (typeof value !== "string" || value.trim() === "") continue;
    const existing = into.sources[key];
    // Simple priority for now. Per-field rules (say, trusting a page's salary
    // over an API that omits it) would slot in exactly here — which is why
    // every field carries its source rather than being merged anonymously.
    if (existing && SOURCE_RANK[existing] >= rank) continue;
    into.fields[key] = value;
    into.sources[key] = evidence.source;
  }
  if (evidence.identity && !into.identity) into.identity = evidence.identity;
  if (evidence.vendor && !into.vendor) into.vendor = evidence.vendor;
  if (evidence.questions?.length && into.questions.length === 0) {
    into.questions = evidence.questions;
  }
  if (evidence.finalUrl) into.finalUrl = evidence.finalUrl;
}

/**
 * Everything we can learn about a posting from its link.
 *
 * Never throws. A posting we cannot read is a result with empty fields and a
 * list of what was tried — which the caller shows to the user, because "we
 * looked and could not see it" is a true and useful thing to say.
 */
export async function extractJob(url: string, deps: ExtractDeps = {}): Promise<ExtractedJob> {
  const adapters = deps.adapters ?? VENDOR_ADAPTERS;
  const attempts: LadderAttempt[] = [];
  const result: ExtractedJob = { fields: {}, sources: {}, questions: [], attempts };

  // ── Rung 1: the URL alone. Free. ──────────────────────────────────────────
  let identity: JobIdentity | null = null;
  let owner: VendorAdapter | null = null;
  for (const adapter of adapters) {
    const found = adapter.fromUrl(url);
    if (found) {
      identity = found;
      owner = adapter;
      break;
    }
  }
  attempts.push({
    layer: "url",
    ok: identity !== null,
    detail: identity
      ? `recognised a ${identity.vendor} posting (${identity.board}/${identity.jobId})`
      : "the link alone does not identify a posting",
  });
  if (identity) merge(result, { source: "url", vendor: identity.vendor, identity, fields: {} });

  // ── Rung 2 and 3, together when we already know who to ask. ───────────────
  const pagePromise =
    deps.html !== undefined
      ? Promise.resolve({ ok: true as const, text: deps.html, finalUrl: url, status: 200 })
      : safeFetchText(url, {
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
          ...(deps.resolve ? { resolve: deps.resolve } : {}),
          ...(deps.signal ? { signal: deps.signal } : {}),
          accept: ["text/html", "application/xhtml", "text/plain"],
        });
  const earlyApi =
    identity && owner ? owner.fetchJob(identity, deps).catch(() => null) : Promise.resolve(null);

  const page = await pagePromise;
  if (page.ok) {
    if (page.finalUrl !== url) {
      attempts.push({ layer: "page", ok: true, detail: `followed a redirect to ${page.finalUrl}` });
    }
    result.finalUrl = page.finalUrl;
    result.page = { ok: true, status: page.status, redirected: page.finalUrl !== url };
    result.pageText = page.text;

    // The fingerprint: who is behind this page, when the link did not say.
    if (!identity) {
      for (const adapter of adapters) {
        const found =
          adapter.fromHtml(page.text, page.finalUrl) ?? adapter.fromHtml(page.text, url);
        if (found) {
          identity = found;
          owner = adapter;
          break;
        }
      }
      attempts.push({
        layer: "page",
        ok: identity !== null,
        detail: identity
          ? `the page names its ${identity.vendor} board (${identity.board})`
          : "the page carries no platform fingerprint we recognise",
      });
      if (identity) {
        merge(result, { source: "url", vendor: identity.vendor, identity, fields: {} });
      }
    }

    const generic = readPage(page.text);
    for (const evidence of generic) merge(result, evidence);
    attempts.push({
      layer: "page",
      ok: generic.length > 0,
      detail: generic.length
        ? `read ${generic.length} thing(s) out of the page itself`
        : "the page had no readable job content (it is probably built in the browser)",
    });
  } else {
    result.page = { ok: false, reason: page.reason };
    attempts.push({ layer: "page", ok: false, detail: page.reason });
  }

  // ── Rung 3: the platform, if we know one. ────────────────────────────────
  const early = await earlyApi;
  const api =
    early ?? (identity && owner ? await owner.fetchJob(identity, deps).catch(() => null) : null);
  if (api) {
    merge(result, api);
    result.vendorAnswered = true;
  }
  if (identity) {
    attempts.push({
      layer: "vendor-api",
      ok: api !== null,
      detail: api
        ? `${identity.vendor} returned the posting`
        : `${identity.vendor} had nothing for ${identity.board}/${identity.jobId}`,
    });
  }

  // Rungs 4 and 5 — the browser extension and the user's own paste — are not
  // reached from here. They arrive as evidence from outside and merge through
  // `mergeExternalEvidence` below, which is the seam they will use.
  return result;
}

/**
 * Fold evidence that came from somewhere this process cannot reach — the
 * browser extension's view of a rendered page, or text the user pasted.
 *
 * Reserved now so the extension work does not have to reshape any of this: it
 * produces an `Evidence` with `source: "browser"` and merges here, outranking
 * everything the server could see and losing only to the user.
 */
export function mergeExternalEvidence(base: ExtractedJob, evidence: Evidence): ExtractedJob {
  const next: ExtractedJob = {
    ...base,
    fields: { ...base.fields },
    sources: { ...base.sources },
    attempts: [...base.attempts],
  };
  merge(next, evidence);
  next.attempts.push({
    layer: evidence.source,
    ok: Object.keys(evidence.fields).length > 0,
    detail:
      evidence.source === "browser"
        ? "the browser panel supplied the rendered page"
        : "supplied directly",
  });
  return next;
}

/** Did the climb come back with a description worth storing? */
export function hasDescription(result: ExtractedJob): boolean {
  return (result.fields.jdText?.trim().length ?? 0) > 0;
}

/** Why an extraction came back empty, in one line a person can act on. */
export function explainEmpty(result: ExtractedJob): string {
  const failed = result.attempts.filter((a) => !a.ok);
  const pageMiss = failed.find((a) => a.layer === "page");
  if (pageMiss) return pageMiss.detail;
  return "nothing on this page identified the job";
}
