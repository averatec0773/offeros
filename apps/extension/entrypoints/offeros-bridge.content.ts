import {
  isOpenableFillUrl,
  type OpenFillTabRequest,
  type OpenFillTabResponse,
} from "../src/lib/fill-binding";

/**
 * The web-app bridge: lets the OfferOS web app (localhost) command this
 * extension without knowing its extension id. The page and this script talk
 * over window.postMessage; this script relays to the background worker.
 *
 * Presence detection is a pure message handshake — READY announced on load,
 * and re-announced whenever the page says HELLO (covers both load orders).
 * Deliberately NO Dom mutation: writing a marker attribute onto <html> made
 * React hydration flag a server/client mismatch on the web app's own pages.
 *
 * Security posture: we only accept messages posted by the page itself
 * (event.source === window, event.origin === our own origin), only with a
 * strictly-validated shape, and the only capability exposed is "open an
 * http(s) tab bound to a fill handoff".
 */
export default defineContentScript({
  matches: ["http://localhost/*", "http://127.0.0.1/*"],
  runAt: "document_idle",
  main(ctx) {
    const version = browser.runtime.getManifest().version;
    const announce = () =>
      window.postMessage(
        { source: "offeros-extension", type: "OFFEROS_EXTENSION_READY", version },
        window.location.origin,
      );

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const d = event.data as
        | { source?: unknown; type?: unknown; requestId?: unknown; handoffId?: unknown; url?: unknown }
        | null;
      if (!d || d.source !== "offeros-web") return;

      if (d.type === "OFFEROS_WEB_HELLO") {
        announce();
        return;
      }

      if (d.type !== "OFFEROS_OPEN_FILL_TAB") return;
      if (typeof d.requestId !== "string" || typeof d.handoffId !== "string" || typeof d.url !== "string") return;

      const requestId = d.requestId;
      const reply = (ok: boolean) =>
        window.postMessage(
          { source: "offeros-extension", type: "OFFEROS_OPEN_FILL_TAB_RESULT", requestId, ok },
          window.location.origin,
        );

      if (d.handoffId === "" || !isOpenableFillUrl(d.url)) {
        reply(false);
        return;
      }
      browser.runtime
        .sendMessage({
          kind: "OFFEROS_OPEN_FILL_TAB",
          handoffId: d.handoffId,
          url: d.url,
        } satisfies OpenFillTabRequest)
        .then((res) => reply((res as OpenFillTabResponse | undefined)?.ok === true))
        .catch(() => reply(false));
    };

    window.addEventListener("message", onMessage);
    announce();
    ctx.onInvalidated(() => {
      window.removeEventListener("message", onMessage);
    });
  },
});
