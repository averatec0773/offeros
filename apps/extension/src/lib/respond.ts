/**
 * Answering an extension message, by the contract Chrome documents.
 *
 * `chrome.runtime.onMessage` recognises two ways to answer: call
 * `sendResponse` synchronously, or `return true` and call it later. Returning a
 * promise is a Firefox/webextension-polyfill idiom, and this extension has no
 * polyfill — `@wxt-dev/browser` is `globalThis.browser?.runtime?.id ?
 * globalThis.browser : globalThis.chrome`, which in Chrome is the native object
 * with the native rules.
 *
 * Measured, because the answer turned out to matter: in Chromium 151 a
 * promise-returning listener DOES resolve the sender, in the service worker and
 * in a content script alike (probe run against this extension: background
 * ENABLE_ON_TAB resolved `{ok:true}`, content-script ENGINE_SCAN resolved
 * `ok:true`). So on that build the old code worked. That is a tolerance, not a
 * guarantee: it is not what Chrome documents, it is not what older Chrome does,
 * and a listener whose delivery depends on which browser build is running is a
 * bug waiting for an update. The documented contract costs one helper.
 *
 * What this guarantees, and what the sender is entitled to: exactly one
 * response on every path — resolution, rejection, and a listener that never
 * finishes at all. A channel left open is the worst failure of the three,
 * because it produces no error anywhere and the caller simply waits.
 */

/** Chrome hands the listener this. */
export type SendResponse = (response: unknown) => void;

/**
 * The background's own patience. Long, because the work behind these messages
 * is a native host spawning a server or Chrome injecting scripts — but finite,
 * because "no answer" must never be one of the outcomes.
 */
export const RESPOND_TIMEOUT_MS = 20_000;

/**
 * Hand `work`'s result to `sendResponse`, once, and tell Chrome to expect it.
 *
 * Always returns `true` — the listener must return it synchronously, and doing
 * it here rather than at each call site is the point: `return true` without a
 * response is precisely the hang this exists to prevent, and the two can no
 * longer be written apart.
 */
export function respondWith<T>(
  work: Promise<T>,
  sendResponse: SendResponse,
  onFailure: (error: unknown) => T,
  timeoutMs: number = RESPOND_TIMEOUT_MS,
): true {
  let answered = false;
  const answer = (value: T) => {
    if (answered) return;
    answered = true;
    clearTimeout(timer);
    try {
      sendResponse(value);
    } catch {
      // The sender is gone (panel closed, tab navigated). Nothing to do and
      // nothing worth saying: the message it was waiting for no longer has
      // anyone to reach.
    }
  };
  const timer = setTimeout(
    () => answer(onFailure(new Error("the background worker took too long to answer"))),
    timeoutMs,
  );
  work.then(answer, (error) => answer(onFailure(error)));
  return true;
}

/** The message text of whatever a rejection carried. */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
