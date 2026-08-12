import type { Db } from "../db/client";
import { getApplication, updateApplication } from "../repositories/application-repo";
import { appendEvent } from "../repositories/application-event-repo";
import { recordShapes } from "../repositories/form-memory-repo";
import { cacheLogo } from "./logo-service";
import { greenhouseRecon } from "./recon/greenhouse";
import type { AtsRecon, ReconVerdict } from "./recon/types";
import { extractJob } from "../extract/ladder";
import type { ExtractedJob } from "../extract/types";
import { VENDOR_ADAPTERS } from "../extract/vendors";

export type { ReconVerdict, ReconQuestion } from "./recon/types";

/**
 * Job reconnaissance: is this posting still there, and what will its form ask?
 *
 * One application, one click, one HTTP request or two. No batch, no schedule,
 * no background sweep — a tool that quietly polls a hundred employers on
 * someone's behalf is a different product with a different risk profile, and
 * this is not it.
 *
 * ZERO model calls. Every conclusion below is a status code, a platform API
 * response, or a string the platform itself emits. The one piece of untrusted
 * text this touches is the posting body, and it only ever lands in `jdText`,
 * whose consumers already fence it.
 *
 * The verdict is allowed to be `unknown`, and that matters more than the happy
 * path: most job URLs are not on a platform we can read, and inventing
 * "closed" for a site that wanted a login would cost the user a real
 * opportunity. We report what we saw.
 */

/** Registered platforms, tried in order. Adding one is an entry here. */
const PLATFORMS: AtsRecon[] = [greenhouseRecon];

/** How long one posting gets to answer. Long enough for a slow board, short
 *  enough that a click does not feel hung. */
const TIMEOUT_MS = 5000;

export interface ReconResult {
  verdict: ReconVerdict;
  /** Why we concluded that, in the user's words, for the card and the event. */
  detail: string;
  vendor?: string;
  /** Questions learned from the platform's API, if it has one. */
  questionsFound?: number;
  requiredFound?: number;
  /** True when this run filled in a job description that was missing. */
  jdBackfilled?: boolean;
  /** Question keys this run learned, linking form_shapes rows to this job. */
  questionKeys?: string[];
  at: number;
}

/** Hosts that mean "you landed on the board, not the posting". */
function looksLikeBoardIndex(finalUrl: string, originalUrl: string): boolean {
  let final: URL;
  let original: URL;
  try {
    final = new URL(finalUrl);
    original = new URL(originalUrl);
  } catch {
    return false;
  }
  if (final.href === original.href) return false;
  // A posting redirecting to the root of the same board, or to a bare careers
  // page, is the usual shape of a posting that has been taken down.
  const path = final.pathname.replace(/\/+$/, "");
  const shallow = path === "" || /^\/(jobs|careers|search|openings)$/.test(path);
  return shallow && original.pathname.replace(/\/+$/, "") !== path;
}

const describe: Record<ReconVerdict, string> = {
  open: "The posting is still up.",
  closed: "The employer's site says this posting is closed.",
  "suspected-closed": "The link now lands on the job board rather than this posting.",
  unknown: "Could not tell — the site did not answer in a way we can read.",
};

export interface ReconDeps {
  fetchImpl?: typeof fetch;
  /** Injected alongside fetch: the host guard has to resolve names, and a test
   *  must be able to say what a name resolves to without touching DNS. */
  resolve?: (hostname: string) => Promise<string[]>;
  now?: () => number;
}

/**
 * Check one application's posting and record what came back.
 *
 * Never throws for a network problem: an employer's site being slow, hostile
 * or unreachable is an answer (`unknown`), not an error the user should see as
 * a broken button.
 */
export async function reconApplication(
  db: Db,
  applicationId: string,
  deps: ReconDeps = {},
): Promise<ReconResult | null> {
  const application = getApplication(db, applicationId);
  if (!application) return null;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const url = application.jobInfo.applyLink?.trim();

  if (!url) {
    return finish(db, applicationId, {
      verdict: "unknown",
      detail: "No link saved for this job, so there is nothing to check.",
      at: now(),
    });
  }

  const platform = PLATFORMS.find((p) => p.matches(url));
  // Fire-and-forget, from the host we are already talking to. It must never
  // affect the verdict, so it is not awaited and its failure is silent — the
  // letter avatar is the floor, not a fallback.
  void cacheLogo(applicationId, url, fetchImpl, deps.resolve).catch(() => false);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // The same climb "add a job" does. Reconnaissance wants a verdict rather
  // than fields, but it wants them from the same evidence — and a posting that
  // answers with its content is, self-evidently, still up.
  const extracted = await extractJob(url, {
    ...(deps.fetchImpl ? { fetchImpl } : {}),
    ...(deps.resolve ? { resolve: deps.resolve } : {}),
    signal: controller.signal,
  }).catch(() => null);

  // Anything the climb learned that we did not have is worth keeping, whatever
  // the verdict turns out to be.
  const backfilled = extracted ? applyExtraction(db, applicationId, extracted) : false;

  try {
    // The verdict, read off the one climb above rather than a second round of
    // requests. Order matters: the platform answering is the strongest
    // evidence a posting is live, and a 404 the strongest that it is not.
    const vendor = extracted?.vendor ?? platform?.vendor;
    const vendorTag = vendor ? { vendor } : {};

    if (!extracted || !extracted.page) {
      return finish(db, applicationId, {
        verdict: "unknown",
        detail: "Could not check the posting.",
        ...vendorTag,
        at: now(),
        ...(backfilled ? { jdBackfilled: true } : {}),
      });
    }

    if (extracted.vendorAnswered) {
      return finish(db, applicationId, {
        verdict: "open",
        detail: describe.open,
        ...vendorTag,
        at: now(),
        ...summarise(extracted, backfilled),
      });
    }

    if (!extracted.page.ok) {
      return finish(db, applicationId, {
        verdict: "unknown",
        detail: `Could not read the posting — ${extracted.page.reason}.`,
        ...vendorTag,
        at: now(),
      });
    }

    const status = extracted.page.status ?? 0;
    if (status === 404 || status === 410) {
      return finish(db, applicationId, {
        verdict: "closed",
        detail: `The posting is gone (HTTP ${status}).`,
        ...vendorTag,
        at: now(),
      });
    }
    if (status >= 400) {
      return finish(db, applicationId, {
        verdict: "unknown",
        detail: `The site answered HTTP ${status}, which does not tell us either way.`,
        ...vendorTag,
        at: now(),
      });
    }
    if (looksLikeBoardIndex(extracted.finalUrl ?? url, url)) {
      return finish(db, applicationId, {
        verdict: "suspected-closed",
        detail: describe["suspected-closed"],
        ...vendorTag,
        at: now(),
      });
    }
    // A platform whose closed-page wording we know gets the page read for it.
    const closed = VENDOR_ADAPTERS.find(
      (adapter) => adapter.vendor === vendor && adapter.closedMarker,
    );
    if (closed?.closedMarker?.(extracted.pageText ?? "")) {
      return finish(db, applicationId, {
        verdict: "closed",
        detail: describe.closed,
        ...vendorTag,
        at: now(),
      });
    }
    if (vendor) {
      return finish(db, applicationId, {
        verdict: "open",
        detail: describe.open,
        ...vendorTag,
        at: now(),
        ...summarise(extracted, backfilled),
      });
    }
    // An unrecognised site answered 200. That is genuinely not evidence the
    // posting is live — plenty of dead links serve a friendly page — so it
    // stays unknown rather than being promoted to "open". Anything the climb
    // did learn was already kept.
    return finish(db, applicationId, {
      verdict: "unknown",
      detail: "The page loaded, but this site is not one we can read a verdict from.",
      at: now(),
      ...(backfilled ? { jdBackfilled: true } : {}),
    });
  } catch {
    return finish(db, applicationId, {
      verdict: "unknown",
      detail: "Could not reach the posting (it timed out or refused the connection).",
      ...(platform ? { vendor: platform.vendor } : {}),
      at: now(),
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What a link can tell us before anything is saved — the same climb, used when
 * adding a job by pasting its URL.
 *
 * Returns null only when the climb found nothing at all; a partial answer (a
 * title but no description, say) is still worth having, and the caller decides
 * what to do with the gaps.
 */
export async function describeJobUrl(
  url: string,
  deps: ReconDeps = {},
): Promise<{
  title: string;
  company: string;
  location: string;
  jdText: string;
  source?: string;
} | null> {
  const found = await extractJob(url, {
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.resolve ? { resolve: deps.resolve } : {}),
  }).catch(() => null);
  if (!found || Object.keys(found.fields).length === 0) return null;
  return {
    title: found.fields.title ?? "",
    company: found.fields.company ?? "",
    location: found.fields.location ?? "",
    jdText: found.fields.jdText ?? "",
    ...(found.sources.jdText ? { source: found.sources.jdText } : {}),
  };
}

/** The counts a recon result carries alongside its verdict. */
function summarise(extracted: ExtractedJob, backfilled: boolean) {
  return {
    ...(extracted.questions.length
      ? {
          questionsFound: extracted.questions.length,
          requiredFound: extracted.questions.filter((q) => q.required).length,
          questionKeys: extracted.questions.map((q) => q.questionKey),
        }
      : {}),
    ...(backfilled ? { jdBackfilled: true } : {}),
  };
}

/**
 * Keep whatever the climb learned that we did not already have.
 *
 * Questions become prescan shapes; a description fills an empty jdText and
 * never replaces one, because an existing description may have come from the
 * real page or from the user. Returns whether a description landed.
 */
function applyExtraction(db: Db, applicationId: string, extracted: ExtractedJob): boolean {
  const vendor = extracted.vendor ?? "unknown";
  if (extracted.questions.length > 0) {
    recordShapes(
      db,
      vendor,
      applicationId,
      extracted.questions.map((q) => ({
        questionKey: q.questionKey,
        question: q.question,
        classifiedType: q.control,
        failed: false,
        required: q.required,
      })),
      Date.now(),
      "prescan",
    );
  }

  const existing = getApplication(db, applicationId);
  const description = extracted.fields.jdText?.trim();
  if (existing && !existing.jdText?.trim() && description) {
    updateApplication(db, applicationId, {
      jdText: description,
      jdSource: extracted.sources.jdText ?? "page",
    });
    return true;
  }
  return false;
}

/**
 * Board APIs hand back the posting as escaped HTML. This is a deliberately
 * small unescape-and-strip: the text goes into `jdText`, which every consumer
 * already fences before it reaches a model, so the job here is legibility, not
 * safety.
 */
export function htmlToText(html: string): string {
  return (
    html
      // Entities FIRST. Greenhouse hands back the body escaped ("&lt;p&gt;"),
      // so stripping tags before unescaping would strip nothing and then
      // reveal the markup — which is exactly what it did until a test caught it.
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
      // &amp; last of the named entities, so "&amp;lt;" does not become a tag.
      .replace(/&amp;/gi, "&")
      .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

/** Write the verdict onto the application's timeline and hand it back. */
function finish(db: Db, applicationId: string, result: ReconResult): ReconResult {
  appendEvent(db, {
    applicationId,
    kind: "job-checked",
    payload: {
      verdict: result.verdict,
      detail: result.detail,
      ...(result.vendor ? { vendor: result.vendor } : {}),
      ...(result.questionsFound !== undefined ? { questionsFound: result.questionsFound } : {}),
      ...(result.questionKeys?.length ? { questionKeys: result.questionKeys } : {}),
      ...(result.jdBackfilled ? { jdBackfilled: true } : {}),
    },
  });
  return result;
}
