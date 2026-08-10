/**
 * In-page panel overlay: a small collapsed badge pinned to the right edge of
 * apply pages that expands into the full OfferOS panel, rendered in an
 * extension-origin iframe (the SAME sidepanel.html the Chrome Side Panel
 * uses — one panel app, two shells). The iframe origin keeps the panel's DOM,
 * storage, and extension APIs isolated from the host page; the host page only
 * ever sees a badge and an iframe element.
 *
 * The Chrome Side Panel remains available (toolbar click) — this overlay is
 * the in-page alternative, not a replacement.
 */

export interface PanelOverlayOptions {
  /** chrome-extension:// URL of the panel document (runtime.getURL). */
  panelUrl: string;
  /** chrome-extension:// URL of the badge logo image. */
  logoUrl: string;
}

export interface PanelOverlay {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** Re-append the host if a framework hydration pass dropped foreign DOM. */
  ensureAttached(): void;
  destroy(): void;
}

const HOST_ID = "offeros-panel-overlay";
const OPEN_KEY = "offeros-overlay-open";

const CSS = `
:host { all: initial; }
.wrap {
  position: fixed;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  z-index: 2147483646;
  display: flex;
  align-items: center;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 6px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-right: none;
  border-radius: 12px 0 0 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  user-select: none;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.badge:hover { transform: translateX(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.16); }
.badge img { width: 26px; height: 26px; display: block; }
.badge .chev { font-size: 10px; line-height: 1; color: #6b7280; }
.panel {
  display: none;
  width: 400px;
  height: min(86vh, 780px);
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 16px 0 0 16px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}
.panel iframe { width: 100%; height: 100%; border: 0; display: block; }
.wrap.open .panel { display: block; }
.wrap.open .badge .chev { transform: rotate(180deg); }
`;

export function createPanelOverlay(doc: Document, opts: PanelOverlayOptions): PanelOverlay {
  const host = doc.createElement("div");
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: "open" });

  const style = doc.createElement("style");
  style.textContent = CSS;
  root.appendChild(style);

  const wrap = doc.createElement("div");
  wrap.className = "wrap";
  root.appendChild(wrap);

  const badge = doc.createElement("button");
  badge.className = "badge";
  badge.type = "button";
  badge.setAttribute("aria-label", "Toggle OfferOS panel");
  const logo = doc.createElement("img");
  logo.src = opts.logoUrl;
  logo.alt = "OfferOS";
  const chev = doc.createElement("span");
  chev.className = "chev";
  chev.textContent = "◀";
  badge.appendChild(logo);
  badge.appendChild(chev);
  wrap.appendChild(badge);

  const panel = doc.createElement("div");
  panel.className = "panel";
  wrap.appendChild(panel);

  // The iframe (a full React app) loads lazily on first open — pages the user
  // never expands OfferOS on pay only for a badge.
  let iframe: HTMLIFrameElement | null = null;
  const ensureIframe = () => {
    // `isConnected`, not just null: when the extension reloads, Chrome
    // destroys every extension-origin frame in the page but this closure (and
    // its captured `iframe` variable) lives on in the orphaned content
    // script's world. Caching the dead node meant the panel opened as a blank
    // white sheet forever — observed on a live Ashby fill, class
    // stale-node-cache. A disconnected frame is rebuilt, not reused.
    if (iframe && iframe.isConnected) return;
    iframe?.remove();
    iframe = doc.createElement("iframe");
    iframe.src = opts.panelUrl;
    iframe.allow = "";
    panel.appendChild(iframe);
  };

  const setOpen = (open: boolean) => {
    if (open) ensureIframe();
    wrap.classList.toggle("open", open);
    try {
      doc.defaultView?.sessionStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      // sessionStorage can be unavailable (sandboxed frames); state just won't persist.
    }
  };
  const isOpen = () => wrap.classList.contains("open");

  badge.addEventListener("click", () => setOpen(!isOpen()));

  doc.body.appendChild(host);

  // Restore the expanded state across SPA navigations within the tab.
  try {
    if (doc.defaultView?.sessionStorage.getItem(OPEN_KEY) === "1") setOpen(true);
  } catch {
    /* see above */
  }

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!isOpen()),
    isOpen,
    ensureAttached: () => {
      if (!host.isConnected && doc.body) doc.body.appendChild(host);
    },
    destroy: () => {
      host.remove();
    },
  };
}
