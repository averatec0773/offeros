// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  extensionPresent,
  openFillTabViaExtension,
  __resetBridgeStateForTests,
} from "../extension-bridge";

afterEach(() => {
  __resetBridgeStateForTests();
});

// happy-dom's postMessage doesn't stamp event.source, so bridge replies are
// dispatched as explicit MessageEvents carrying source: window — the same
// shape a real same-window postMessage delivers in a browser.
const dispatchFromBridge = (data: unknown) => {
  window.dispatchEvent(
    new MessageEvent("message", { data, origin: window.location.origin, source: window }),
  );
};

describe("extensionPresent", () => {
  it("is false before the bridge announces and true after READY", () => {
    expect(extensionPresent()).toBe(false);
    dispatchFromBridge({
      source: "offeros-extension",
      type: "OFFEROS_EXTENSION_READY",
      version: "1.0.0",
    });
    expect(extensionPresent()).toBe(true);
  });

  it("ignores READY-shaped messages from other sources", () => {
    expect(extensionPresent()).toBe(false);
    dispatchFromBridge({ source: "someone-else", type: "OFFEROS_EXTENSION_READY" });
    expect(extensionPresent()).toBe(false);
  });
});

describe("openFillTabViaExtension", () => {
  it("resolves true when the bridge replies ok to the matching request", async () => {
    const bridge = (event: MessageEvent) => {
      const d = event.data as { source?: string; type?: string; requestId?: string };
      if (d?.source !== "offeros-web" || d.type !== "OFFEROS_OPEN_FILL_TAB") return;
      dispatchFromBridge({
        source: "offeros-extension",
        type: "OFFEROS_OPEN_FILL_TAB_RESULT",
        requestId: d.requestId,
        ok: true,
      });
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
      dispatchFromBridge({
        source: "offeros-extension",
        type: "OFFEROS_OPEN_FILL_TAB_RESULT",
        requestId: "someone-elses-request",
        ok: true,
      });
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
