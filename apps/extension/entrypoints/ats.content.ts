import { matchAts, looksLikeApplicationForm } from "../src/lib/autofill/recipes";
import { registerEngine } from "../src/lib/engine/engine-service";
import { createPanelOverlay } from "../src/lib/overlay/panel-overlay";
import { getFillBinding } from "../src/lib/fill-binding";
import { atsMatches } from "../src/lib/ats-hosts";

export default defineContentScript({
  matches: atsMatches(),
  // document_end, not the default document_idle: the panel starts probing the
  // moment the tab activates, and on heavy React ATS pages idle can be seconds
  // away — the engine's message listener must exist before the page settles.
  // An early scan may see a half-rendered form; the page watcher pushes
  // PAGE_CHANGED as hydration mutates, so the panel re-scans to full quality.
  runAt: "document_end",
  async main(ctx) {
    // Two ways to be here, and they are not the same.
    //
    // The manifest injects this script automatically on the five listed ATS
    // platforms, and there `matchAts` names the site. Everywhere else the
    // script only arrives because the user pressed "Enable OfferOS on this
    // page" — no match, no recipe, and no site knowledge whatsoever. That case
    // has to earn its place: a blog comment box and a newsletter signup are
    // both forms, and filling one with somebody's phone number because they
    // asked for help on a careers page would be the worst kind of eager.
    //
    // So an unmatched page registers the engine only if it actually looks like
    // an application form. When it does not, the script simply does nothing and
    // the panel keeps saying it cannot reach the page — which is true.
    if (!matchAts(location.href) && !looksLikeApplicationForm(document)) return;

    // Fill-highlight style (one literal color — on the page, not in any shadow
    // root, so it cannot read var(--brand)). #00f0a0 is the web app's brand green
    // (apps/web/src/app/globals.css --brand).
    const style = document.createElement("style");
    style.textContent =
      ".offeros-filled{outline:2px solid #00f0a0 !important;transition:outline .2s}";
    document.head.appendChild(style);

    // The DOM fill engine, driven by the side panel over messaging (SCAN/FILL/
    // CAPTURE_JD over runtime.onMessage + a page-change push).
    registerEngine(document, ctx);

    // In-page overlay: a collapsed badge on the right edge that expands into
    // the panel app in an extension-origin iframe. The Chrome Side Panel stays
    // available from the toolbar — two shells, one panel.
    const overlay = createPanelOverlay(document, {
      panelUrl: browser.runtime.getURL("/sidepanel.html"),
      logoUrl: browser.runtime.getURL("/icon/48.png"),
    });
    ctx.onInvalidated(() => overlay.destroy());

    // A tab the workspace opened for a specific handoff auto-expands the
    // panel — the user asked to fill this job, so the copilot shows up ready.
    void getFillBinding().then((handoffId) => {
      if (handoffId) overlay.open();
    });

    // Keep-alive: Greenhouse job boards hydrate <html>; a hydration mismatch
    // rebuilds the whole tree and silently drops foreign DOM — our style tag
    // and the overlay host. Re-append both idempotently. Debounced to stay cheap.
    let styleTimer: ReturnType<typeof setTimeout> | undefined;
    const ensureStyle = () => {
      if (!style.isConnected && document.head) document.head.appendChild(style);
      overlay.ensureAttached();
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
