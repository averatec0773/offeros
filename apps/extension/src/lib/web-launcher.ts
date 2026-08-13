/**
 * One-click "start the web app" over Chrome native messaging. The panel asks
 * the background, the background asks the registered native host
 * (`com.offeros.host`, see scripts/native-host-install.mjs), and Chrome spawns
 * that host on demand — no standing daemon. The host starts the local dev
 * server as a detached child and returns immediately; the panel's own ping
 * loop observes readiness.
 */
import { withTimeout } from "./with-timeout";

export const START_WEB_APP = "OFFEROS_START_WEB_APP" as const;

export interface StartWebAppRequest {
  kind: typeof START_WEB_APP;
}
export interface StartWebAppResponse {
  ok: boolean;
  /** Present on failure — surfaced verbatim in the panel banner. */
  error?: string;
}

export function isStartWebAppRequest(m: unknown): m is StartWebAppRequest {
  return typeof m === "object" && m !== null && (m as { kind?: unknown }).kind === START_WEB_APP;
}

/** Panel → background. Resolves {ok:false} (never rejects) when no background answers. */
/** Spawning a native host is slower than a lookup, and still not unbounded. */
export const START_WEB_APP_TIMEOUT_MS = 15_000;

export async function requestStartWebApp(): Promise<StartWebAppResponse> {
  const ask = (async (): Promise<StartWebAppResponse> => {
    try {
      return (await browser.runtime.sendMessage({
        kind: START_WEB_APP,
      } satisfies StartWebAppRequest)) as StartWebAppResponse;
    } catch {
      return { ok: false, error: "extension background unavailable" };
    }
  })();
  return withTimeout(ask, START_WEB_APP_TIMEOUT_MS, () => ({
    ok: false,
    error: "the background worker didn't answer",
  }));
}

const NOT_INSTALLED_HINT =
  "One-click start isn't set up — run `npm run host:install` in the repo once, then retry.";

/** Background side: call the native host. Chrome spawns it per call. */
export function startWebAppViaHost(): Promise<StartWebAppResponse> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage("com.offeros.host", { cmd: "start" }, (res) => {
        const err = chrome.runtime.lastError;
        if (err) {
          const notFound = /not found|forbidden/i.test(err.message ?? "");
          resolve({
            ok: false,
            error: notFound ? NOT_INSTALLED_HINT : (err.message ?? "native host error"),
          });
          return;
        }
        const r = res as { ok?: boolean; error?: string } | undefined;
        resolve(r?.ok ? { ok: true } : { ok: false, error: r?.error ?? "native host refused" });
      });
    } catch {
      resolve({ ok: false, error: NOT_INSTALLED_HINT });
    }
  });
}
