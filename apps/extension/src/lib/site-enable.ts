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

/** Panel → background. Resolves `{ok:false}` (never rejects) when nobody answers. */
export async function requestEnableOnTab(tabId: number): Promise<EnableOnTabResponse> {
  try {
    return (await browser.runtime.sendMessage({
      kind: ENABLE_ON_TAB,
      tabId,
    } satisfies EnableOnTabRequest)) as EnableOnTabResponse;
  } catch {
    return { ok: false, error: "The extension's background worker isn't running — try again." };
  }
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
 * Must be called inside a user gesture — Chrome refuses otherwise, verbatim:
 * "This function must be called during a user gesture". The panel's button
 * click is one; the background worker never is, which is why this lives on the
 * panel side of the bridge rather than next to the injection it unblocks.
 */
export async function requestSiteAccess(
  url: string,
  permissions: typeof chrome.permissions | undefined = globalThis.chrome?.permissions,
): Promise<boolean> {
  const origins = originPatternFor(url);
  if (!origins || !permissions?.request) return false;
  try {
    if (await permissions.contains({ origins: [origins] })) return true;
    return await permissions.request({ origins: [origins] });
  } catch {
    return false;
  }
}
