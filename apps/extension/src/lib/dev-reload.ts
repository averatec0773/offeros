/**
 * Dev-only auto-reload: unpacked extensions are served straight from disk, so
 * polling our own packaged `dev-reload-stamp.json` (written by
 * scripts/dev-reload-stamp.mjs after every `npm run build`) detects a fresh
 * build the moment it lands. The caller decides what "reload" means —
 * `browser.runtime.reload()` in the background, `location.reload()` in the
 * side panel.
 *
 * Inert everywhere it must be:
 * - store builds carry an `update_url` → no-op,
 * - builds without a stamp (e.g. `wxt zip`'s internal build) → the first
 *   fetch fails and nothing is scheduled.
 *
 * While watching from the MV3 service worker, a 20s `getPlatformInfo()` tick
 * keeps the worker alive so the poll interval actually runs — scheduled ONLY
 * when a stamp exists, so production workers sleep normally.
 */
export async function startDevReload(
  onChange: () => void,
  opts: { intervalMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<() => void> {
  const intervalMs = opts.intervalMs ?? 1500;
  const fetchImpl = opts.fetchImpl ?? fetch;

  try {
    if (browser.runtime.getManifest().update_url) return () => {};
  } catch {
    // Manifest unavailable (test harness) — treat as a dev context.
  }

  // The stamp is written post-build (never in public/), so it's outside WXT's
  // generated PublicPath union — the cast is the whole point: this file only
  // exists in dev builds.
  const url = (browser.runtime.getURL as (path: string) => string)("/dev-reload-stamp.json");
  let last: string;
  try {
    const first = await fetchImpl(url, { cache: "no-store" });
    if (!first.ok) return () => {};
    last = await first.text();
  } catch {
    return () => {};
  }

  const poll = setInterval(async () => {
    try {
      const res = await fetchImpl(url, { cache: "no-store" });
      if (!res.ok) return;
      const text = await res.text();
      if (text !== last) {
        last = text;
        onChange();
      }
    } catch {
      // Transient read during a rebuild — keep polling.
    }
  }, intervalMs);
  const keepAlive = setInterval(() => {
    void browser.runtime.getPlatformInfo?.();
  }, 20_000);

  return () => {
    clearInterval(poll);
    clearInterval(keepAlive);
  };
}
