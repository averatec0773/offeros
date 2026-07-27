import { matchAts } from "../src/lib/autofill/recipes";
import { registerEngine } from "../src/lib/engine/engine-service";

export default defineContentScript({
  matches: [
    "https://*.greenhouse.io/*",
    "https://boards.greenhouse.io/*",
    "https://job-boards.greenhouse.io/*",
    "https://jobs.lever.co/*",
    "https://jobs.eu.lever.co/*",
    "https://*.ashbyhq.com/*",
    "https://*.icims.com/*",
    "https://*.myworkdayjobs.com/*",
  ],
  async main(ctx) {
    if (!matchAts(location.href)) return;

    // Fill-highlight style (one literal color — on the page, not in any shadow
    // root, so it cannot read var(--brand)). #00f0a0 is the web app's brand green
    // (apps/web/src/app/globals.css --brand).
    const style = document.createElement("style");
    style.textContent = ".offeros-filled{outline:2px solid #00f0a0 !important;transition:outline .2s}";
    document.head.appendChild(style);

    // The DOM fill engine, driven by the side panel over messaging (SCAN/FILL/
    // CAPTURE_JD over runtime.onMessage + a page-change push). No on-page UI.
    registerEngine(document, ctx);

    // Keep-alive: Greenhouse job boards hydrate <html>; a hydration mismatch
    // rebuilds the whole tree and silently drops foreign DOM — our style tag.
    // Re-append it idempotently. Debounced to stay cheap.
    let styleTimer: ReturnType<typeof setTimeout> | undefined;
    const ensureStyle = () => {
      if (!style.isConnected && document.head) document.head.appendChild(style);
    };
    const keepAlive = new MutationObserver(() => {
      clearTimeout(styleTimer);
      styleTimer = setTimeout(ensureStyle, 300);
    });
    keepAlive.observe(document.documentElement, { childList: true, subtree: true });
    ctx.onInvalidated(() => {
      clearTimeout(styleTimer);
      keepAlive.disconnect();
    });
  },
});
