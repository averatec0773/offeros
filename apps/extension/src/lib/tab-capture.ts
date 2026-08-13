import { browser } from "wxt/browser";
import { withTimeout } from "./with-timeout";

/**
 * Panel → background: photograph the visible tab.
 *
 * Only the background can call `chrome.tabs.captureVisibleTab`, so the panel
 * asks for it over the runtime bus — the same pattern as the native-host
 * bridge in web-launcher.ts. The image is the third, independent witness in
 * the fill-evidence story (see apps/web's evidence-service): the browser's own
 * pixels, not the engine's account of them.
 *
 * Capture is best-effort by design. Every failure collapses to `{ok:false}`;
 * a missing screenshot must never break a fill, a report, or the Done button.
 */

export const CAPTURE_TAB = "OFFEROS_CAPTURE_TAB" as const;

export type CaptureTabRequest = { kind: typeof CAPTURE_TAB; tabId?: number };
export type CaptureTabResponse = { ok: true; dataUrl: string } | { ok: false; error: string };

export function isCaptureTabRequest(m: unknown): m is CaptureTabRequest {
  return typeof m === "object" && m !== null && (m as { kind?: unknown }).kind === CAPTURE_TAB;
}

/** How long to wait for the background to photograph a tab. */
export const CAPTURE_TIMEOUT_MS = 8_000;

/**
 * Panel side. Resolves `{ok:false}` (never rejects, never hangs).
 *
 * Best-effort has always meant "a missing screenshot must not break the fill".
 * It never meant "say nothing": every reason lands in the returned error, and
 * the caller records it. A capture that silently did nothing left us believing
 * evidence was being collected when none ever was.
 */
export async function requestTabCapture(tabId?: number): Promise<CaptureTabResponse> {
  const ask = (async (): Promise<CaptureTabResponse> => {
    try {
      return (await browser.runtime.sendMessage({
        kind: CAPTURE_TAB,
        ...(tabId !== undefined && tabId >= 0 ? { tabId } : {}),
      } satisfies CaptureTabRequest)) as CaptureTabResponse;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "extension background unavailable",
      };
    }
  })();
  return withTimeout(ask, CAPTURE_TIMEOUT_MS, () => ({
    ok: false as const,
    error: "the background worker didn't answer the screenshot request",
  }));
}

/**
 * Background side. `captureVisibleTab` photographs whatever tab is ACTIVE in
 * the window — the tabId is only used to find the right window, which is why
 * the caller scrolls the field into view first and captures immediately after.
 */
export async function captureTab(tabId?: number): Promise<CaptureTabResponse> {
  try {
    const windowId =
      tabId !== undefined && tabId >= 0 ? (await browser.tabs.get(tabId)).windowId : undefined;
    const dataUrl = await browser.tabs.captureVisibleTab(windowId as number, { format: "png" });
    if (typeof dataUrl !== "string" || dataUrl === "") {
      return { ok: false, error: "captureVisibleTab returned nothing" };
    }
    return { ok: true, dataUrl };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
