import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChromeMessaging, PORT_CLOSED, type ChromeMessaging } from "./chrome-messaging";
import { reasonOf, respondWith } from "../src/lib/respond";

/**
 * The promise every message sender is entitled to: exactly one answer, on every
 * path, including the paths nobody plans for.
 *
 * Read tests/chrome-messaging.ts first — the bus these run on has Chrome's
 * rules, where a listener that returns a promise is simply not answering.
 */

let bus: ChromeMessaging;
beforeEach(() => {
  bus = installChromeMessaging();
});
afterEach(() => bus.restore());

describe("respondWith", () => {
  it("answers with what the work resolved to", async () => {
    browser.runtime.onMessage.addListener(((_m: unknown, _s: unknown, send: (r: unknown) => void) =>
      respondWith(Promise.resolve({ ok: true }), send, () => ({ ok: false }))) as never);

    expect(await bus.send({ kind: "anything" })).toEqual({ ok: true });
  });

  it("answers when the work rejects, instead of leaving the channel open", async () => {
    browser.runtime.onMessage.addListener(((_m: unknown, _s: unknown, send: (r: unknown) => void) =>
      respondWith(Promise.reject(new Error("native host missing")), send, (error) => ({
        ok: false,
        error: reasonOf(error),
      }))) as never);

    expect(await bus.send({ kind: "anything" })).toEqual({
      ok: false,
      error: "native host missing",
    });
  });

  it("answers when the work never finishes at all", async () => {
    vi.useFakeTimers();
    try {
      browser.runtime.onMessage.addListener(((
        _m: unknown,
        _s: unknown,
        send: (r: unknown) => void,
      ) =>
        respondWith(
          new Promise(() => {}),
          send,
          () => ({ ok: false, error: "gave up" }),
          20_000,
        )) as never);

      const pending = bus.send({ kind: "anything" });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await pending).toEqual({ ok: false, error: "gave up" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers exactly once when the work finishes after the timeout has fired", async () => {
    vi.useFakeTimers();
    try {
      let resolveLate!: (v: unknown) => void;
      const late = new Promise((r) => {
        resolveLate = r;
      });
      const sent: unknown[] = [];
      const send = (r: unknown) => sent.push(r);

      respondWith(late, send, () => ({ ok: false, error: "gave up" }), 1000);
      await vi.advanceTimersByTimeAsync(1000);
      resolveLate({ ok: true });
      await vi.advanceTimersByTimeAsync(1000);

      // A second sendResponse on a closed channel throws in Chrome; more to the
      // point, the caller has already acted on the first answer.
      expect(sent).toEqual([{ ok: false, error: "gave up" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("survives a sender that has gone away", async () => {
    const send = () => {
      throw new Error("Attempting to use a disconnected port object");
    };
    // The panel was closed while the work ran. Nothing to do about it, and
    // nothing that should reach the background's own error handling.
    expect(() => respondWith(Promise.resolve(1), send, () => 0)).not.toThrow();
    await Promise.resolve();
  });

  it("tells Chrome to hold the channel open, synchronously", () => {
    const returned = respondWith(
      Promise.resolve(1),
      () => {},
      () => 0,
    );
    // `return true` is the whole reason the answer is allowed to be late. It
    // has to be the synchronous return value, which is why respondWith returns
    // it rather than leaving each call site to remember.
    expect(returned).toBe(true);
  });
});

describe("the bus itself", () => {
  it("refuses to answer a listener that returns a promise", async () => {
    // The mistake this whole exercise is about, asserted directly on the
    // double. If this ever passes, the double has been loosened and every test
    // that relies on it has quietly stopped meaning anything.
    browser.runtime.onMessage.addListener((() => Promise.resolve({ ok: true })) as never);
    await expect(bus.send({ kind: "anything" })).rejects.toThrow(PORT_CLOSED);
  });

  it("answers a listener that responds synchronously", async () => {
    browser.runtime.onMessage.addListener(((_m: unknown, _s: unknown, send: (r: unknown) => void) =>
      send("here")) as never);
    expect(await bus.send({ kind: "anything" })).toBe("here");
  });

  it("never settles for a listener that holds the channel and then forgets", async () => {
    vi.useFakeTimers();
    try {
      browser.runtime.onMessage.addListener((() => true) as never);
      let settled = false;
      void bus.send({ kind: "anything" }).then(
        () => (settled = true),
        () => (settled = true),
      );
      await vi.advanceTimersByTimeAsync(600_000);
      // Ten minutes later, still nothing. This is the failure mode the whole
      // change exists to make impossible in shipped code.
      expect(settled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
