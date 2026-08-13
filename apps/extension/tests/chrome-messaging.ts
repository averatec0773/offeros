import { browser } from "wxt/browser";

/**
 * A message bus with Chrome's rules, because the default one has Firefox's.
 *
 * THE CONTRACT THIS MODELS — `chrome.runtime.onMessage`:
 *
 *   - a listener may answer synchronously by calling `sendResponse`;
 *   - or it may `return true`, which keeps the channel open, and call
 *     `sendResponse` later;
 *   - **any other return value is ignored, a returned Promise included.** The
 *     channel closes and the sender is never given an answer.
 *
 * Returning a promise is the webextension-polyfill idiom. This extension has no
 * polyfill — `@wxt-dev/browser` resolves to `globalThis.chrome` in Chrome — so
 * the native rules are the only rules that apply to shipped code.
 *
 * WHY THIS FILE EXISTS. The test double these tests used before (WXT's
 * `fakeBrowser`) awaits whatever a listener returns, so a promise-returning
 * listener looked perfectly healthy in every test while implementing a
 * mechanism the target platform does not document. A double that is more
 * permissive than the platform does not test the code; it tests a browser
 * nobody runs. This is the second time that has cost us — the first was a fake
 * `permissions` object, which has no notion of a user gesture and so could not
 * see that the permission prompt was being asked for after the gesture had
 * already been spent.
 *
 * **Loosening this to accept a returned promise would make every test in the
 * files that use it meaningless.** If a future Chrome documents promise
 * support, change the production code to rely on it deliberately and say so
 * there — do not teach the double to accept both.
 *
 * (Measured, for the record: Chromium 151 does in fact resolve a
 * promise-returning listener, in the service worker and in a content script.
 * That is a tolerance of one build, not the contract, and this double holds the
 * contract.)
 */

type SendResponse = (response: unknown) => void;
type Listener = (message: unknown, sender: unknown, sendResponse: SendResponse) => unknown;

export interface ChromeMessaging {
  /** Deliver a message the way Chrome delivers it. */
  send(message: unknown, sender?: unknown): Promise<unknown>;
  /** Put the original messaging back. */
  restore(): void;
  /** How many listeners are currently registered. */
  count(): number;
}

/** Chrome's own words when a channel closes with nobody answering. */
export const PORT_CLOSED = "The message port closed before a response was received.";

/**
 * Swap `browser.runtime.onMessage` / `sendMessage` for Chrome's semantics.
 *
 * Call in `beforeEach`, `restore()` in `afterEach`.
 */
export function installChromeMessaging(): ChromeMessaging {
  const listeners = new Set<Listener>();
  const runtime = browser.runtime as unknown as {
    onMessage: { addListener: unknown; removeListener: unknown };
    sendMessage: unknown;
  };
  const original = {
    addListener: runtime.onMessage.addListener,
    removeListener: runtime.onMessage.removeListener,
    sendMessage: runtime.sendMessage,
  };

  runtime.onMessage.addListener = (l: Listener) => listeners.add(l);
  runtime.onMessage.removeListener = (l: Listener) => listeners.delete(l);

  const send = (message: unknown, sender: unknown = {}): Promise<unknown> =>
    new Promise((resolve, reject) => {
      let answered = false;
      let channelHeld = false;
      const sendResponse: SendResponse = (response) => {
        if (answered) return;
        answered = true;
        resolve(response);
      };
      for (const listener of listeners) {
        const returned = listener(message, sender, sendResponse);
        if (answered) return;
        // The ONLY thing that keeps the channel open. A promise here is not a
        // promise to Chrome; it is an object it does not look at.
        if (returned === true) channelHeld = true;
      }
      if (answered) return;
      if (!channelHeld) reject(new Error(PORT_CLOSED));
      // Otherwise: pending until sendResponse is called. If it never is, this
      // promise never settles — which is the failure this whole exercise is
      // about, and a test may assert it with fake timers.
    });

  runtime.sendMessage = send;

  return {
    send,
    count: () => listeners.size,
    restore: () => {
      runtime.onMessage.addListener = original.addListener;
      runtime.onMessage.removeListener = original.removeListener;
      runtime.sendMessage = original.sendMessage;
      listeners.clear();
    },
  };
}
