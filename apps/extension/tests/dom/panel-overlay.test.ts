// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createPanelOverlay, type PanelOverlay } from "../../src/lib/overlay/panel-overlay";

const OPTS = {
  panelUrl: "chrome-extension://abc/sidepanel.html",
  logoUrl: "chrome-extension://abc/icon/48.png",
};

let overlay: PanelOverlay | null = null;

afterEach(() => {
  overlay?.destroy();
  overlay = null;
  sessionStorage.clear();
  document.body.innerHTML = "";
});

const shadow = () => document.getElementById("offeros-panel-overlay")!.shadowRoot!;

describe("createPanelOverlay", () => {
  it("mounts a collapsed badge and no iframe until first open", () => {
    overlay = createPanelOverlay(document, OPTS);
    expect(shadow().querySelector(".badge")).toBeTruthy();
    expect(overlay.isOpen()).toBe(false);
    expect(shadow().querySelector("iframe")).toBeNull();
  });

  it("open() lazily loads the panel iframe pointing at the extension panel page", () => {
    overlay = createPanelOverlay(document, OPTS);
    overlay.open();
    expect(overlay.isOpen()).toBe(true);
    const iframe = shadow().querySelector("iframe")!;
    expect(iframe.src).toBe(OPTS.panelUrl);
    expect(shadow().querySelector(".wrap")!.classList.contains("open")).toBe(true);
  });

  it("badge click toggles; the iframe survives a close (no reload on reopen)", () => {
    overlay = createPanelOverlay(document, OPTS);
    const badge = shadow().querySelector<HTMLButtonElement>(".badge")!;
    badge.click();
    expect(overlay.isOpen()).toBe(true);
    const iframe = shadow().querySelector("iframe");
    badge.click();
    expect(overlay.isOpen()).toBe(false);
    // Closed = hidden, not torn down: reopening must not reboot the panel app.
    expect(shadow().querySelector("iframe")).toBe(iframe);
  });

  it("persists the expanded state across re-creation (SPA navigation)", () => {
    overlay = createPanelOverlay(document, OPTS);
    overlay.open();
    overlay.destroy();
    overlay = createPanelOverlay(document, OPTS);
    expect(overlay.isOpen()).toBe(true);
    overlay.close();
    overlay.destroy();
    overlay = createPanelOverlay(document, OPTS);
    expect(overlay.isOpen()).toBe(false);
  });

  it("ensureAttached re-appends the host after a hydration pass dropped it", () => {
    overlay = createPanelOverlay(document, OPTS);
    document.getElementById("offeros-panel-overlay")!.remove();
    expect(document.getElementById("offeros-panel-overlay")).toBeNull();
    overlay.ensureAttached();
    expect(document.getElementById("offeros-panel-overlay")).toBeTruthy();
  });

  it("destroy removes the host entirely", () => {
    overlay = createPanelOverlay(document, OPTS);
    overlay.destroy();
    expect(document.getElementById("offeros-panel-overlay")).toBeNull();
    overlay = null;
  });
});
