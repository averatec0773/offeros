import type { Db } from "../db/client";
import { getApplication, updateApplication } from "../repositories/application-repo";
import { appendEvent } from "../repositories/application-event-repo";
import { recordShapes } from "../repositories/form-memory-repo";
import { cacheLogo } from "./logo-service";
import { greenhouseRecon } from "./recon/greenhouse";
import type { AtsRecon, ProbeResult, ReconQuestion, ReconVerdict } from "./recon/types";
import { safeFetchText } from "../net/safe-fetch";

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

  try {
    // Platforms with a public API are asked directly — it answers both
    // questions (is it live, what does it ask) in one call, and it answers
    // them in the platform's own words rather than from parsed markup.
    if (platform?.probe) {
      const probe = await platform.probe(url, fetchImpl, controller.signal);
      // A probe that reached a conclusion ends it. One that could not — the
      // API was down, or answered something unrecognisable — falls through to
      // the page below, which may still carry the platform's own closed
      // wording. Giving up at the first `unknown` would throw away evidence
      // that is one request away.
      if (probe && probe.verdict !== "unknown") {
        return finish(db, applicationId, applyProbe(db, application.id, platform, probe, now()));
      }
    }

    // Everything else: fetch the page and read the status code, the final URL
    // and — only for a platform whose closed-page wording we know — the text.
    // Through the shared guard, which re-checks the host on every redirect
    // hop: a board's own link 301s to the employer's domain, so the host we
    // end up talking to is routinely not the one we were given.
    const page = await safeFetchText(url, {
      fetchImpl,
      ...(deps.resolve ? { resolve: deps.resolve } : {}),
      timeoutMs: TIMEOUT_MS,
      signal: controller.signal,
    });
    if (!page.ok) {
      return finish(db, applicationId, {
        verdict: "unknown",
        detail: `Could not read the posting — ${page.reason}.`,
        ...(platform ? { vendor: platform.vendor } : {}),
        at: now(),
      });
    }
    const response = { status: page.status, url: page.finalUrl };
    if (response.status === 404 || response.status === 410) {
      return finish(db, applicationId, {
        verdict: "closed",
        detail: `The posting is gone (HTTP ${response.status}).`,
        ...(platform ? { vendor: platform.vendor } : {}),
        at: now(),
      });
    }
    if (response.status >= 400) {
      return finish(db, applicationId, {
        verdict: "unknown",
        detail: `The site answered HTTP ${response.status}, which does not tell us either way.`,
        ...(platform ? { vendor: platform.vendor } : {}),
        at: now(),
      });
    }
    if (looksLikeBoardIndex(response.url || url, url)) {
      return finish(db, applicationId, {
        verdict: "suspected-closed",
        detail: describe["suspected-closed"],
        ...(platform ? { vendor: platform.vendor } : {}),
        at: now(),
      });
    }
    if (platform) {
      if (platform.closedMarker(page.text)) {
        return finish(db, applicationId, {
          verdict: "closed",
          detail: describe.closed,
          vendor: platform.vendor,
          at: now(),
        });
      }
      return finish(db, applicationId, {
        verdict: "open",
        detail: describe.open,
        vendor: platform.vendor,
        at: now(),
      });
    }
    // An unrecognised site answered 200. That is genuinely not evidence the
    // posting is live — plenty of dead links serve a friendly page — so it
    // stays unknown rather than being promoted to "open".
    return finish(db, applicationId, {
      verdict: "unknown",
      detail: "The page loaded, but this site is not one we can read a verdict from.",
      at: now(),
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
 * What a platform can tell us about a URL before anything is saved.
 *
 * Used when adding a job by pasting its link: on a platform we can read, the
 * title, company and description come from the platform itself rather than
 * from the user retyping them. Anywhere else this returns null and the caller
 * keeps what it has — a minimal record with an editable title is honest; a
 * guessed one is not.
 */
export async function describeJobUrl(
  url: string,
  deps: ReconDeps = {},
): Promise<{ title: string; company: string; location: string; jdText: string } | null> {
  const platform = PLATFORMS.find((p) => p.matches(url));
  if (!platform?.probe) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const probe = await platform.probe(url, deps.fetchImpl ?? fetch, controller.signal);
    if (!probe?.job) return null;
    return {
      title: probe.job.title,
      company: probe.job.company,
      location: probe.job.location,
      jdText: htmlToText(probe.job.descriptionHtml),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Store what a platform probe returned: questions, and a JD if we had none. */
function applyProbe(
  db: Db,
  applicationId: string,
  platform: AtsRecon,
  probe: ProbeResult,
  at: number,
): ReconResult {
  const questions = probe.questions ?? [];
  if (questions.length > 0) {
    recordShapes(
      db,
      platform.vendor,
      applicationId,
      questions.map((q: ReconQuestion) => ({
        questionKey: q.questionKey,
        question: q.question,
        classifiedType: q.control,
        failed: false,
        required: q.required,
      })),
      at,
      // Never counts as having met the question on a real form, and never
      // overwrites what a real fill recorded.
      "prescan",
    );
  }

  // Backfill the description only when we have none. An existing jdText may
  // have been captured from the real page (or edited by the user); this is the
  // weaker source, so it does not get to replace it.
  let jdBackfilled = false;
  const existing = getApplication(db, applicationId);
  const description = probe.job?.descriptionHtml?.trim();
  if (existing && !existing.jdText?.trim() && description) {
    updateApplication(db, applicationId, { jdText: htmlToText(description) });
    jdBackfilled = true;
  }

  return {
    verdict: probe.verdict,
    detail: describe[probe.verdict],
    vendor: platform.vendor,
    questionsFound: questions.length,
    requiredFound: questions.filter((q) => q.required).length,
    // The keys, not the questions: the text lives once in form_shapes, and
    // this is the per-application link back to it. Without it a prescan would
    // be a global pile of questions with no way to say which form they
    // belonged to.
    questionKeys: questions.map((q) => q.questionKey),
    ...(jdBackfilled ? { jdBackfilled: true } : {}),
    at,
  };
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
