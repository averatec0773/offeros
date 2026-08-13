/**
 * Turning OfferOS on for one page, because the user asked.
 *
 * The engine reaches a page by being injected there, and injection is driven by
 * the manifest's match list — which names five ATS platforms and nothing else.
 * Most application forms in the world are not on those five. On everything else
 * the panel had nothing to offer and no way to explain itself: the extension
 * simply was not there.
 *
 * The alternative to a match list is not a longer match list. It is asking. The
 * user opens the panel on whatever page they are looking at, presses one
 * button, and the engine is injected into that tab — that tab, that visit,
 * because they said so. Nothing is injected anywhere they did not ask, and
 * navigating away ends it: Chrome tears the scripts down with the document, and
 * the panel offers the button again rather than silently reinjecting behind
 * their back. Silent reinjection would be exactly the standing presence this
 * avoids.
 */

import { withTimeout } from "./with-timeout";

export const ENABLE_ON_TAB = "OFFEROS_ENABLE_ON_TAB" as const;

export interface EnableOnTabRequest {
  kind: typeof ENABLE_ON_TAB;
  tabId: number;
}

export interface EnableOnTabResponse {
  ok: boolean;
  /** Present on failure — shown verbatim, never swallowed. */
  error?: string;
  /**
   * The injection was refused because the extension holds no permission for
   * this site. Not an error to show: it is the cue to ask the user for that one
   * site and try again. Distinguished from every other failure because those
   * (an enterprise policy, a page whose CSP refuses the world injection) are not
   * fixed by asking.
   */
  needsPermission?: boolean;
}

export function isEnableOnTabRequest(m: unknown): m is EnableOnTabRequest {
  const r = m as { kind?: unknown; tabId?: unknown } | null;
  return (
    typeof m === "object" && m !== null && r!.kind === ENABLE_ON_TAB && typeof r!.tabId === "number"
  );
}

/**
 * Pages Chrome will not let any extension into, whatever it has been granted.
 *
 * Offering a button that cannot work is worse than offering none — the user
 * presses it, nothing happens, and the extension looks broken rather than
 * restricted. So these are named and explained instead.
 */
const BLOCKED_HOST_SUFFIXES = [
  // The Web Store is off limits to extensions by Chrome policy.
  "chrome.google.com",
  "chromewebstore.google.com",
];

/** Why this page cannot be enabled, in words, or null when it can. */
export function whyCannotEnable(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "This tab has no page to read yet.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    // chrome://, edge://, about:, file:, view-source:, extension pages.
    return "OfferOS can only be enabled on ordinary web pages, not on browser or local-file pages.";
  }
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOST_SUFFIXES.some((h) => host === h || host.endsWith(`.${h}`))) {
    return "Chrome does not let extensions run on the Web Store.";
  }
  return null;
}

/** True when the enable button should be offered for this URL. */
export function canEnableUrl(url: string): boolean {
  return whyCannotEnable(url) === null;
}

/**
 * The permission pattern for one site — scheme and host, nothing narrower.
 *
 * Chrome grants host permissions per origin, so this is the smallest thing that
 * can be asked for. A path-scoped grant is not a thing Chrome offers; asking
 * for `https://careers.example.com/*` is asking for that site.
 */
export function originPatternFor(url: string): string | null {
  try {
    const { protocol, host } = new URL(url);
    if (protocol !== "http:" && protocol !== "https:") return null;
    return `${protocol}//${host}/*`;
  } catch {
    return null;
  }
}

/** Chrome's wording for "you have no permission for this host". */
function readsAsMissingPermission(message: string): boolean {
  return /must request permission|Cannot access contents of|not allowed to access/i.test(message);
}

/** Injection is a couple of executeScript calls; this is a ceiling, not a budget. */
export const INJECT_TIMEOUT_MS = 10_000;

/** Panel → background. Resolves `{ok:false}` (never rejects, never hangs). */
export async function requestEnableOnTab(tabId: number): Promise<EnableOnTabResponse> {
  const ask = (async (): Promise<EnableOnTabResponse> => {
    try {
      return (await browser.runtime.sendMessage({
        kind: ENABLE_ON_TAB,
        tabId,
      } satisfies EnableOnTabRequest)) as EnableOnTabResponse;
    } catch {
      return { ok: false, error: "The extension's background worker isn't running — try again." };
    }
  })();
  return withTimeout(ask, INJECT_TIMEOUT_MS, () => ({ ok: false, error: INJECT_TIMED_OUT }));
}

/**
 * The two scripts that make a page fillable, and the one place that names them.
 *
 * The engine runs ISOLATED (it owns the message handlers the panel drives); the
 * combobox driver runs in MAIN, because reading a React widget's internals is
 * only possible from the page's own world. Both the orphan-recovery sweep and
 * the user's enable button inject exactly this pair — one function, so a third
 * script could never be added to one path and forgotten in the other.
 */
export async function injectEngine(
  tabId: number,
  scripting: typeof chrome.scripting,
): Promise<void> {
  await scripting.executeScript({
    target: { tabId },
    files: ["content-scripts/ats.js"],
  });
  await scripting.executeScript({
    target: { tabId },
    files: ["content-scripts/ats-driver.js"],
    world: "MAIN",
  });
}

/**
 * Background side of the enable button.
 *
 * Failure is reported, not swallowed. An enterprise policy, a page whose CSP
 * refuses the world injection, a tab that navigated between the click and the
 * call — each produces a real message the panel shows, because a button that
 * appears to do nothing is the worst of the three outcomes.
 */
export async function enableOnTab(
  tabId: number,
  url: string,
  scripting: typeof chrome.scripting | undefined,
): Promise<EnableOnTabResponse> {
  const blocked = whyCannotEnable(url);
  if (blocked) return { ok: false, error: blocked };
  if (!scripting?.executeScript) {
    return { ok: false, error: "This browser build can't inject scripts on request." };
  }
  try {
    await injectEngine(tabId, scripting);
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Measured, not guessed: without a permission for this host Chrome answers
    // "Cannot access contents of url ... Extension manifest must request
    // permission to access this host." That is answerable — the panel asks the
    // user for this one site and calls back. Anything else is a real failure.
    if (readsAsMissingPermission(detail)) {
      return { ok: false, needsPermission: true, error: detail };
    }
    return { ok: false, error: `Couldn't start OfferOS on this page: ${detail}` };
  }
}

/**
 * Ask Chrome for one site, from the panel.
 *
 * MUST be called inside a user gesture, and a gesture does not survive an
 * await. Chrome's rule is verbatim "This function must be called during a user
 * gesture", and what counts is the synchronous run of the click handler: the
 * moment control returns to the event loop — one `await`, one `.then`, one
 * message round-trip — the gesture is spent, and `permissions.request` is no
 * longer answerable. A prompt that is never shown does not reject either. It
 * simply never resolves, and the button that was waiting on it says "Starting…"
 * until the panel is closed. That is not a hypothetical; it is what a user got.
 *
 * So the ordering is the contract, and it is enforced by shape rather than by
 * memory:
 *
 *   - this function is NOT `async`. An async function is free to grow an await
 *     above the request one day and nothing would look wrong;
 *   - it does not check `permissions.contains` first, however sensible that
 *     reads. That check is an await, and it would spend the gesture before the
 *     request it was meant to inform. Ask the question earlier instead —
 *     `hasSiteAccess` exists for that, and the panel calls it when the tab
 *     changes, where there is no gesture to lose.
 *
 * The one thing before the request is a synchronous URL parse.
 */
export function requestSiteAccess(
  url: string,
  permissions: typeof chrome.permissions | undefined = globalThis.chrome?.permissions,
): Promise<boolean> {
  const origins = originPatternFor(url);
  if (!origins || !permissions?.request) return Promise.resolve(false);
  try {
    // Nothing may be awaited above this line.
    return Promise.resolve(permissions.request({ origins: [origins] })).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

/** What the panel knows about this site before anybody clicks anything. */
export type SiteAccess = "granted" | "missing" | "unknown";

/**
 * Do we already hold permission for this site?
 *
 * `permissions.contains` needs no gesture, so this is asked when the tab
 * changes — early, off the click path, and at leisure. Knowing the answer in
 * advance is what lets the click go straight to the request without an await
 * in front of it, and equally what keeps a user who already said yes from being
 * asked a second time.
 */
export async function hasSiteAccess(
  url: string,
  permissions: typeof chrome.permissions | undefined = globalThis.chrome?.permissions,
): Promise<SiteAccess> {
  const origins = originPatternFor(url);
  if (!origins || !permissions?.contains) return "unknown";
  try {
    return (await permissions.contains({ origins: [origins] })) ? "granted" : "missing";
  } catch {
    return "unknown";
  }
}

/** How long the whole enable flow may take before the panel gives up on it.
 *  Generous on purpose: most of it is a person reading a permission prompt. */
export const ENABLE_TIMEOUT_MS = 15_000;

/**
 * Two different silences, two different sentences.
 *
 * One message covered both branches, so an injection that timed out told the
 * user Chrome had not answered a permission request — when no permission
 * request had been made at all. Wrong text on a diagnostic is worse than none:
 * it sent a real investigation in the wrong direction.
 */
export const ENABLE_TIMED_OUT =
  "Chrome didn't answer the permission request. You can allow this site from chrome://extensions → OfferOS → Site access, then try again.";

export const INJECT_TIMED_OUT =
  "OfferOS couldn't start on this page — the extension's background worker didn't answer. Reload the page and try again.";

export const ENABLE_REFUSED =
  "OfferOS needs your permission for this site to read its form. Nothing changed.";

/** Told to someone whose first click taught us the permission was missing. */
export const ENABLE_ASK_AGAIN =
  "OfferOS needs your permission for this site — press Enable again and Chrome will ask.";

export interface EnableResult {
  ok: boolean;
  error?: string;
  /** The permission state this attempt learned, when it learned one. */
  learned?: SiteAccess;
}

export interface EnableDeps {
  /** What the tab-change precheck found. */
  siteAccess: SiteAccess;
  /** `permissions.request`, wrapped. Called before anything is awaited. */
  askForSite: (url: string) => Promise<boolean>;
  /** Panel → background injection. */
  inject: () => Promise<EnableOnTabResponse>;
  timeoutMs?: number;
}

/**
 * The enable button's whole flow, arranged around the gesture.
 *
 * NOT `async`, and the branch order is deliberate. When the precheck says the
 * permission is missing, the request goes out on the click's own stack frame,
 * before any message to the background — the previous arrangement asked the
 * background first and only reached for the permission after that round-trip,
 * by which time no prompt could open.
 *
 * When the precheck says the permission is held, nothing is asked at all: the
 * injection is attempted directly, and a user who has already said yes to this
 * site never sees a second prompt.
 *
 * "unknown" is the honest middle — no permissions API, or a precheck that has
 * not landed. It tries the injection, and if Chrome says the permission is what
 * is missing it reports back what it learned and asks the user to press again.
 * A second press is one gesture; guessing and prompting someone who had already
 * granted the site would cost more.
 */
export function beginEnable(url: string, deps: EnableDeps): Promise<EnableResult> {
  const timeoutMs = deps.timeoutMs ?? ENABLE_TIMEOUT_MS;
  const timedOut = (): EnableResult => ({ ok: false, error: ENABLE_TIMED_OUT });

  if (deps.siteAccess === "missing") {
    // Nothing may be awaited above this line: this IS the user gesture.
    const asked = deps.askForSite(url);
    return withTimeout(
      asked.then((granted) =>
        granted
          ? deps.inject().then((res) => ({ ...res, learned: "granted" as SiteAccess }))
          : { ok: false, error: ENABLE_REFUSED, learned: "missing" as SiteAccess },
      ),
      timeoutMs,
      timedOut,
    );
  }

  return withTimeout(
    deps.inject().then((res): EnableResult => {
      if (res.ok || res.needsPermission !== true) return res;
      // Chrome refused for want of a permission we did not know was missing.
      // Asking now is not possible — the gesture went with the round-trip
      // above — so the next press is set up to ask first.
      return { ok: false, error: ENABLE_ASK_AGAIN, learned: "missing" };
    }),
    timeoutMs,
    // Nothing was asked for on this branch, so nothing can have gone unanswered
    // but the injection itself.
    () => ({ ok: false, error: INJECT_TIMED_OUT }),
  );
}
