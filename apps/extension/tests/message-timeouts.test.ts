import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMessaging, type ChromeMessaging } from "./chrome-messaging";
import { requestTabCapture, CAPTURE_TIMEOUT_MS } from "../src/lib/tab-capture";
import { getFillBindingResult, BINDING_TIMEOUT_MS } from "../src/lib/fill-binding";
import { requestStartWebApp, START_WEB_APP_TIMEOUT_MS } from "../src/lib/web-launcher";
import { requestEnableOnTab, INJECT_TIMED_OUT, INJECT_TIMEOUT_MS } from "../src/lib/site-enable";

/**
 * No sender waits forever.
 *
 * These run on the Chrome-semantics bus (see chrome-messaging.ts), where a
 * listener that holds the channel open and never answers leaves the sender
 * pending — which is exactly what a background worker that has crashed, been
 * torn down mid-message, or hit a bug in its own handler looks like from here.
 *
 * Two of these paths were the reason the fault went unnoticed for so long:
 * the screenshot is best-effort and simply did nothing, and the binding lookup
 * has a URL-guessing fallback that absorbed the silence. Best-effort has to
 * mean "carries on", never "says nothing".
 */

let bus: ChromeMessaging;
beforeEach(() => {
  bus = installChromeMessaging();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  bus.restore();
});

/** A background that takes the message and is never heard from again. */
const silentBackground = () => browser.runtime.onMessage.addListener((() => true) as never);

describe("a background that never answers", () => {
  it("does not leave a screenshot request pending, and says why", async () => {
    silentBackground();
    const pending = requestTabCapture(7);
    await vi.advanceTimersByTimeAsync(CAPTURE_TIMEOUT_MS);
    const res = await pending;
    expect(res.ok).toBe(false);
    // The evidence screenshot is allowed to fail. It is not allowed to fail
    // without saying so — that is how we came to believe screenshots were being
    // taken when none ever arrived.
    expect(res.ok === false && res.error).toMatch(/didn't answer/i);
  });

  it("tells the binding lookup apart from a tab with no binding", async () => {
    silentBackground();
    const pending = getFillBindingResult(3);
    await vi.advanceTimersByTimeAsync(BINDING_TIMEOUT_MS);
    const res = await pending;
    expect(res.handoffId).toBeNull();
    expect(res.answered).toBe(false);
    expect(res.error).toMatch(/didn't answer/i);
  });

  it("reports a real 'no binding' as answered", async () => {
    browser.runtime.onMessage.addListener(((_m: unknown, _s: unknown, send: (r: unknown) => void) =>
      send({ handoffId: null })) as never);
    const res = await getFillBindingResult(3);
    expect(res).toMatchObject({ handoffId: null, answered: true });
  });

  it("hands back the web-app start button", async () => {
    silentBackground();
    const pending = requestStartWebApp();
    await vi.advanceTimersByTimeAsync(START_WEB_APP_TIMEOUT_MS);
    expect(await pending).toMatchObject({ ok: false });
  });

  it("hands back the enable button, blaming the injection rather than a prompt", async () => {
    silentBackground();
    const pending = requestEnableOnTab(5);
    await vi.advanceTimersByTimeAsync(INJECT_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, error: INJECT_TIMED_OUT });
  });
});

describe("a background that does answer", () => {
  it("passes the answer straight through, with no timer left behind", async () => {
    browser.runtime.onMessage.addListener(((_m: unknown, _s: unknown, send: (r: unknown) => void) =>
      send({ ok: true, dataUrl: "data:image/png;base64,AA" })) as never);

    const res = await requestTabCapture(7);
    expect(res).toEqual({ ok: true, dataUrl: "data:image/png;base64,AA" });
    // Nothing pending: a stray timer would keep the worker alive for no reason.
    expect(vi.getTimerCount()).toBe(0);
  });
});
