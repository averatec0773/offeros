/**
 * Feature-detect and command the OfferOS browser extension from the web app.
 *
 * Presence is a message handshake, never a DOM marker: the bridge announces
 * READY on load and re-announces on HELLO; this module keeps a flag. (A
 * marker attribute on <html> caused React hydration mismatches — the
 * extension mutated the tree before React attached.)
 *
 * The only capability exposed is "open an apply tab bound to a fill
 * handoff" — from then on the task follows that TAB (redirects and in-tab
 * navigation keep the binding), which is what retires URL-guessing on the
 * extension side.
 */

let bridgePresent = false;
let initialized = false;

function ensureInit(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("message", (event: MessageEvent) => {
    const d = event.data as { source?: unknown; type?: unknown } | null;
    if (event.source !== window || !d) return;
    if (d.source === "offeros-extension" && d.type === "OFFEROS_EXTENSION_READY") {
      bridgePresent = true;
    }
  });
  // Cover the bridge-loaded-first order: ask it to re-announce.
  window.postMessage({ source: "offeros-web", type: "OFFEROS_WEB_HELLO" }, window.location.origin);
}

// Eager init on the client: the listener must exist before the user's first
// click, or READY announcements land on deaf ears and presence reads false.
ensureInit();

/** True once the extension's bridge has announced itself on this page. */
export function extensionPresent(): boolean {
  ensureInit();
  return bridgePresent;
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
  ensureInit();
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

/** Test-only: reset module state between cases. */
export function __resetBridgeStateForTests(): void {
  bridgePresent = false;
  initialized = false;
}
