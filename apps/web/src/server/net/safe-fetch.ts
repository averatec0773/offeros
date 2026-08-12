import { lookup } from "node:dns/promises";

/**
 * Fetching a URL a user pasted, without turning this machine into a proxy for
 * its own network.
 *
 * OfferOS runs on someone's laptop, behind their router, often beside things
 * that trust the local network implicitly. Until now it fetched job postings
 * with `redirect: "follow"` and no host check at all — so a link that resolved
 * to, or redirected to, `127.0.0.1:8080` or `192.168.1.1` would have been
 * fetched happily and its body handed back. That is the whole of SSRF, and a
 * job board is exactly the kind of place a hostile link arrives from.
 *
 * The redirect part is not hypothetical. A real posting on a job board 301s to
 * the employer's own domain, which is a different host than the one that was
 * checked — so checking only the URL the caller passed in would validate a
 * host we never actually talk to. Every hop is re-checked, which is why
 * redirects are followed by hand here instead of by the fetch layer.
 *
 * What this deliberately does NOT do: pretend to be a browser. No spoofed
 * User-Agent, no captcha or bot-wall evasion. When a site will not serve a
 * server, the honest answer is that the user's browser can see it and we
 * cannot — and the extension is the right tool for that page.
 */

/** Refusals are values, not exceptions. Every caller here has an honest
 *  "could not tell" state, and a throw would be a worse version of it. */
export type SafeFetchResult =
  | { ok: true; response: Response; finalUrl: string; bytes: Uint8Array }
  | { ok: false; reason: string };

export interface SafeFetchOptions {
  fetchImpl?: typeof fetch;
  /** Injected so tests can decide what a hostname resolves to. */
  resolve?: (hostname: string) => Promise<string[]>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** When set, the response's content-type must start with one of these. */
  accept?: string[];
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

/** Hostnames that mean "this machine" without needing to resolve anything. */
const LOCAL_NAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);

function ipv4Parts(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? numbers : null;
}

/**
 * Is this address one we must never fetch from?
 *
 * Loopback, link-local (which includes cloud metadata at 169.254.169.254),
 * the RFC1918 private ranges, carrier-grade NAT, and the unspecified address.
 * IPv6 covers ::1, the unique-local fc00::/7 block, link-local fe80::/10, and
 * v4-mapped forms of all of the above.
 */
export function isPrivateAddress(address: string): boolean {
  const host = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (host === "") return true;

  // IPv6, including ::ffff:127.0.0.1 style v4-mapped addresses.
  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
    if (mapped) return isPrivateAddress(mapped[1]!);
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true; // fe80::/10 link-local
    return false;
  }

  const parts = ipv4Parts(host);
  if (!parts) return false; // not an IP literal; the name check handles it
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 127) return true; // unspecified, loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

/**
 * Would talking to this host mean talking to our own network?
 *
 * Resolves the name, because `anything.example` can point at 127.0.0.1 — the
 * literal check alone would be trivially bypassed. A name that will not
 * resolve is refused too: we cannot vouch for where it would have gone.
 *
 * Known and accepted limitation: between this lookup and the request, DNS can
 * change (rebinding). Closing that needs pinning the resolved address into the
 * connection itself, which is a much larger change to how requests are made.
 * Stated here rather than papered over.
 */
export async function isPublicHost(
  hostname: string,
  resolver: (hostname: string) => Promise<string[]> = defaultResolve,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const host = hostname.trim().toLowerCase();
  if (host === "" || LOCAL_NAMES.has(host)) {
    return { ok: false, reason: `refusing to fetch from ${hostname || "an empty host"}` };
  }
  if (isPrivateAddress(host)) {
    return { ok: false, reason: `refusing to fetch a private address (${hostname})` };
  }
  let addresses: string[];
  try {
    addresses = await resolver(host);
  } catch {
    return { ok: false, reason: `could not resolve ${hostname}` };
  }
  if (addresses.length === 0) return { ok: false, reason: `could not resolve ${hostname}` };
  const bad = addresses.find((address) => isPrivateAddress(address));
  if (bad) {
    return { ok: false, reason: `${hostname} resolves to a private address (${bad})` };
  }
  return { ok: true };
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true });
  return results.map((r) => r.address);
}

/** Read a body with a hard ceiling, so a hostile server cannot stream forever. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) return null;
  return new Uint8Array(buffer);
}

/**
 * Fetch a URL the user gave us, checking every host we are about to talk to.
 *
 * Redirects are followed manually — that is the point. `redirect: "follow"`
 * would hand the whole chain to the fetch layer, and only the first host would
 * ever have been checked.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolver = options.resolve ?? defaultResolve;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort);

  try {
    let current = url;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(current);
      } catch {
        return { ok: false, reason: "that is not a URL we can fetch" };
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return { ok: false, reason: `refusing to fetch a ${parsed.protocol} URL` };
      }
      // Re-checked on EVERY hop: a trusted host can redirect anywhere.
      const allowed = await isPublicHost(parsed.hostname, resolver);
      if (!allowed.ok) return { ok: false, reason: allowed.reason };

      let response: Response;
      try {
        response = await fetchImpl(current, { redirect: "manual", signal: controller.signal });
      } catch {
        return { ok: false, reason: "could not reach it (timed out or refused the connection)" };
      }

      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }

      if (options.accept) {
        // Only when the server actually declared one. A missing content-type
        // is not a wrong content-type, and plenty of real servers omit it —
        // refusing those would reject pages we can read perfectly well.
        const type = (response.headers.get("content-type") ?? "").toLowerCase();
        if (type !== "" && !options.accept.some((prefix) => type.startsWith(prefix))) {
          return { ok: false, reason: `unexpected content type (${type})` };
        }
      }

      const bytes = await readCapped(response, maxBytes).catch(() => null);
      if (!bytes) return { ok: false, reason: "the response was too large to read" };
      return { ok: true, response, finalUrl: current, bytes };
    }
    return { ok: false, reason: `too many redirects (over ${maxRedirects})` };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** The common case: a page, as text. */
export async function safeFetchText(
  url: string,
  options: SafeFetchOptions = {},
): Promise<
  { ok: true; text: string; finalUrl: string; status: number } | { ok: false; reason: string }
> {
  const result = await safeFetch(url, options);
  if (!result.ok) return result;
  return {
    ok: true,
    text: new TextDecoder().decode(result.bytes),
    finalUrl: result.finalUrl,
    status: result.response.status,
  };
}
