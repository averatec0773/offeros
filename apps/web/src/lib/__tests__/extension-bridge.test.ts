// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { extensionPresent, openFillTabViaExtension } from "../extension-bridge";

afterEach(() => {
  delete document.documentElement.dataset.offerosExtension;
});

describe("extensionPresent", () => {
  it("is false without the bridge marker and true with it", () => {
    expect(extensionPresent()).toBe(false);
    document.documentElement.dataset.offerosExtension = "1.0.0";
    expect(extensionPresent()).toBe(true);
  });
});

describe("openFillTabViaExtension", () => {
  it("resolves true when the bridge replies ok to the matching request", async () => {
    // Fake the bridge content script: echo the requestId back with ok:true.
    // happy-dom's postMessage doesn't stamp event.source, so the reply is
    // dispatched as an explicit MessageEvent carrying source: window — the
    // same shape a real same-window postMessage delivers in a browser.
    const bridge = (event: MessageEvent) => {
      const d = event.data as { source?: string; type?: string; requestId?: string };
      if (d?.source !== "offeros-web" || d.type !== "OFFEROS_OPEN_FILL_TAB") return;
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "offeros-extension",
            type: "OFFEROS_OPEN_FILL_TAB_RESULT",
            requestId: d.requestId,
            ok: true,
          },
          origin: window.location.origin,
          source: window,
        }),
      );
    };
    window.addEventListener("message", bridge);
    try {
      await expect(openFillTabViaExtension("h1", "https://x.test/apply")).resolves.toBe(true);
    } finally {
      window.removeEventListener("message", bridge);
    }
  });

  it("ignores replies for other requestIds and times out to false", async () => {
    const bridge = (event: MessageEvent) => {
      const d = event.data as { source?: string; type?: string };
      if (d?.source !== "offeros-web" || d.type !== "OFFEROS_OPEN_FILL_TAB") return;
      window.postMessage(
        {
          source: "offeros-extension",
          type: "OFFEROS_OPEN_FILL_TAB_RESULT",
          requestId: "someone-elses-request",
          ok: true,
        },
        window.location.origin,
      );
    };
    window.addEventListener("message", bridge);
    try {
      await expect(openFillTabViaExtension("h1", "https://x.test/apply", 150)).resolves.toBe(false);
    } finally {
      window.removeEventListener("message", bridge);
    }
  });

  it("resolves false when nothing answers (extension absent)", async () => {
    await expect(openFillTabViaExtension("h1", "https://x.test/apply", 100)).resolves.toBe(false);
  });
});
