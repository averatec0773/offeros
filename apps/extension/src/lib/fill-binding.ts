/**
 * Explicit fill-tab binding: the workspace commands the extension to open the
 * apply page, and the created tab is bound to the handoff id. From then on the
 * task follows the TAB, not a URL — redirects, wizard steps, and the user
 * navigating from a careers directory to the real posting all keep the
 * binding intact. The panel claims the bound handoff directly; the
 * matchHandoff URL heuristics remain only as a fallback for tabs the user
 * opened manually.
 *
 * Two message layers share these shapes:
 *   - window.postMessage between the web app page and the localhost bridge
 *     content script (see entrypoints/offeros-bridge.content.ts),
 *   - runtime messages between bridge/panel/content scripts and the
 *     background worker, which owns the tabId → handoffId store.
 */

import { withTimeout } from "./with-timeout";

/** Page → extension (via the bridge): open `url` in a new tab bound to `handoffId`. */
export interface OpenFillTabRequest {
  kind: "OFFEROS_OPEN_FILL_TAB";
  handoffId: string;
  url: string;
}

export interface OpenFillTabResponse {
  ok: boolean;
  tabId?: number;
}

/** Which handoff (if any) is bound to a tab. `tabId` omitted = the sender's own tab. */
export interface GetFillBindingRequest {
  kind: "OFFEROS_GET_FILL_BINDING";
  tabId?: number;
}

export interface GetFillBindingResponse {
  handoffId: string | null;
}

function hasKind(m: unknown, kind: string): m is { kind: string } {
  return typeof m === "object" && m !== null && (m as { kind?: unknown }).kind === kind;
}

export function isOpenFillTabRequest(m: unknown): m is OpenFillTabRequest {
  if (!hasKind(m, "OFFEROS_OPEN_FILL_TAB")) return false;
  const r = m as Partial<OpenFillTabRequest>;
  return typeof r.handoffId === "string" && r.handoffId !== "" && typeof r.url === "string";
}

export function isGetFillBindingRequest(m: unknown): m is GetFillBindingRequest {
  if (!hasKind(m, "OFFEROS_GET_FILL_BINDING")) return false;
  const t = (m as Partial<GetFillBindingRequest>).tabId;
  return t === undefined || typeof t === "number";
}

/** Only ever open web pages — reject javascript:, chrome:, file:, data: etc. */
export function isOpenableFillUrl(url: string): boolean {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** How long to wait on the background for a binding lookup. It reads one
 *  session-storage key; anything approaching this means it is not answering. */
export const BINDING_TIMEOUT_MS = 5_000;

/**
 * Ask the background which handoff is bound to `tabId` (own tab when omitted).
 *
 * `{ handoffId: null }` and "the background never answered" are different
 * facts, and callers that fall back to guessing the handoff from the URL should
 * know which one they got: guessing after a definite "no binding" is the
 * designed path, guessing because the bus is broken is papering over a fault.
 * Both still return null for the handoff, so no caller has to change.
 */
export async function getFillBindingResult(
  tabId?: number,
): Promise<{ handoffId: string | null; answered: boolean; error?: string }> {
  const ask = (async () => {
    try {
      const res = (await browser.runtime.sendMessage({
        kind: "OFFEROS_GET_FILL_BINDING",
        ...(tabId !== undefined ? { tabId } : {}),
      } satisfies GetFillBindingRequest)) as GetFillBindingResponse | undefined;
      return { handoffId: res?.handoffId ?? null, answered: true };
    } catch (error) {
      return {
        handoffId: null,
        answered: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })();
  return withTimeout(ask, BINDING_TIMEOUT_MS, () => ({
    handoffId: null,
    answered: false,
    error: "the background worker didn't answer the binding lookup",
  }));
}

/** The handoff bound to this tab, or null. */
export async function getFillBinding(tabId?: number): Promise<string | null> {
  return (await getFillBindingResult(tabId)).handoffId;
}
