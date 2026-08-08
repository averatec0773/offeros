/**
 * Feature-detect and command the OfferOS browser extension from the web app.
 *
 * The extension's bridge content script (injected on localhost pages) marks
 * its presence on <html data-offeros-extension="…"> and relays strictly-shaped
 * window.postMessage requests to its background worker. The only capability
 * exposed is "open an apply tab bound to a fill handoff" — from then on the
 * task follows that TAB (redirects and in-tab navigation keep the binding),
 * which is what retires URL-guessing on the extension side.
 */

/** True when the extension's bridge has announced itself on this page. */
export function extensionPresent(): boolean {
  return (
    typeof document !== "undefined" && Boolean(document.documentElement.dataset.offerosExtension)
  );
}

/**
 * Ask the extension to open `url` in a new tab bound to `handoffId`.
 * Resolves false on timeout (extension missing/stale) or refusal — callers
 * fall back to a plain window.open.
 */
export function openFillTabViaExtension(
  handoffId: string,
  url: string,
  timeoutMs = 3000,
): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2);
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const onMessage = (event: MessageEvent) => {
      const d = event.data as {
        source?: unknown;
        type?: unknown;
        requestId?: unknown;
        ok?: unknown;
      } | null;
      if (
        event.source !== window ||
        !d ||
        d.source !== "offeros-extension" ||
        d.type !== "OFFEROS_OPEN_FILL_TAB_RESULT" ||
        d.requestId !== requestId
      ) {
        return;
      }
      finish(d.ok === true);
    };
    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: "offeros-web", type: "OFFEROS_OPEN_FILL_TAB", requestId, handoffId, url },
      window.location.origin,
    );
  });
}
