import { withTimeout } from "./with-timeout";

/**
 * Getting the engine onto whatever page the panel is looking at.
 *
 * Five ATS platforms are in the manifest's match list and Chrome injects them
 * automatically. Everywhere else the engine arrives on request — and the
 * request is made by the panel simply being open on that page. No button, no
 * permission prompt, nothing for the user to find.
 *
 * It used to be a button backed by a per-site permission the user granted from
 * the panel. That was the narrower design and it did not survive use: an
 * application form is usually on a company's own careers page, so the common
 * case was the one that needed a grant, and the grant machinery produced days
 * of failures — a panel stuck on "Starting…", a timeout message blaming a
 * permission prompt that had never opened — while never once showing the owner
 * the prompt it existed for. The manifest now asks for all sites up front (see
 * wxt.config.ts, which explains that trade), which is both more honest about
 * what the extension can do and what makes this path possible.
 *
 * What has not changed: pages Chrome will not let any extension into are named
 * and explained rather than silently failing, an injection is verified rather
 * than assumed, and nothing is injected into a page the panel is not on.
 */

export const ENABLE_ON_TAB = "OFFEROS_ENABLE_ON_TAB" as const;

export interface EnableOnTabRequest {
  kind: typeof ENABLE_ON_TAB;
  tabId: number;
}

export interface EnableOnTabResponse {
  ok: boolean;
  /** Present on failure — shown verbatim, never swallowed. */
  error?: string;
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
 * `<all_urls>` does not include these, and no permission does. Saying so beats
 * failing quietly: an extension that appears to do nothing looks broken rather
 * than restricted.
 */
const BLOCKED_HOST_SUFFIXES = [
  // The Web Store is off limits to extensions by Chrome policy.
  "chrome.google.com",
  "chromewebstore.google.com",
];

/** Why this page cannot be read, in words, or null when it can. */
export function whyCannotEnable(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "This tab has no page to read yet.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    // chrome://, edge://, about:, file:, view-source:, extension pages.
    return "OfferOS can only read ordinary web pages, not browser or local-file pages.";
  }
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOST_SUFFIXES.some((h) => host === h || host.endsWith(`.${h}`))) {
    return "Chrome does not let extensions run on the Web Store.";
  }
  return null;
}

/** True when the engine can be put on this page at all. */
export function canEnableUrl(url: string): boolean {
  return whyCannotEnable(url) === null;
}

/** Injection is a couple of executeScript calls; this is a ceiling, not a budget. */
export const INJECT_TIMEOUT_MS = 10_000;

export const INJECT_TIMED_OUT =
  "OfferOS couldn't start on this page — the extension's background worker didn't answer. Reload the page and try again.";

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
 * the panel's on-demand path inject exactly this pair — one function, so a
 * third script could never be added to one path and forgotten in the other.
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
 * Put the engine on a tab, unless it is already there.
 *
 * Asked for every page the panel opens on, so it has to be safe to ask twice:
 * a second injection would register a second set of message handlers and every
 * scan would be answered twice. The ping settles it — the engine answers one if
 * it is present, and an unanswered ping is Chrome telling us there is no
 * receiver on that page.
 *
 * Failure is reported, not swallowed. An enterprise policy, a page whose CSP
 * refuses the world injection, a tab that navigated mid-call — each produces a
 * real message the panel shows.
 */
export async function enableOnTab(
  tabId: number,
  url: string,
  scripting: typeof chrome.scripting | undefined,
  ping: (tabId: number) => Promise<unknown> = (id) =>
    browser.tabs.sendMessage(id, { kind: "OFFEROS_ENGINE_PING" }),
): Promise<EnableOnTabResponse> {
  const blocked = whyCannotEnable(url);
  if (blocked) return { ok: false, error: blocked };
  if (!scripting?.executeScript) {
    return { ok: false, error: "This browser build can't inject scripts on request." };
  }
  try {
    await ping(tabId);
    // Somebody answered: the engine is already on this page.
    return { ok: true };
  } catch {
    // Nobody there. Fall through and put it there.
  }
  try {
    await injectEngine(tabId, scripting);
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Couldn't start OfferOS on this page: ${detail}` };
  }
}
