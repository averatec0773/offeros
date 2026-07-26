/**
 * Local-only request guard for the `/api/v1` surface.
 *
 * OfferOS is a single-user, local-first app: the API is intentionally
 * unauthenticated, but it must only ever answer the person sitting at this
 * machine. Two cheap header checks buy that:
 *
 *  - **Host** pins every request to a loopback name. A DNS-rebinding page that
 *    resolves `evil.example` to 127.0.0.1 still sends `Host: evil.example`, so
 *    it is rejected even if the listener were ever bound beyond loopback.
 *  - **Origin** blocks cross-site writes (CSRF). Browsers always attach an
 *    Origin to mutating cross-origin requests; a non-browser client (curl, a
 *    script) sends none, and that is allowed on purpose.
 *
 * Dependency-free and pure so it can run on the edge runtime (middleware) and
 * be unit-tested without a server.
 */

/** Methods that cannot change state — reads are already covered by Host + the
 *  browser's same-origin policy, so they are not gated on Origin. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Loopback host names, as they appear in a Host header (IPv6 in brackets). */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Origin schemes allowed on top of a loopback host. */
const LOCAL_ORIGIN_SCHEMES = new Set(["http:", "https:"]);

/** The extension is a first-class API client; its origin is `chrome-extension://<id>`. */
const EXTENSION_SCHEME = "chrome-extension:";

export type ApiRequestInfo = {
  method: string;
  /** Raw `Host` header (may include a port). Missing/empty → rejected. */
  host: string | null | undefined;
  /** Raw `Origin` header. Absent → allowed; `"null"` → rejected on writes. */
  origin?: string | null;
};

/** Strip the port from a Host header value, keeping IPv6 brackets intact. */
function hostName(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value : value.slice(0, end + 1);
  }
  const colon = value.indexOf(":");
  return colon === -1 ? value : value.slice(0, colon);
}

export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return LOCAL_HOSTS.has(hostName(host));
}

export function isAllowedOrigin(origin: string): boolean {
  // `Origin: null` is what sandboxed iframes and some cross-site redirects
  // send. It carries no provenance, so it never counts as local.
  if (origin === "null") return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol === EXTENSION_SCHEME) return true;
  if (!LOCAL_ORIGIN_SCHEMES.has(url.protocol)) return false;
  return LOCAL_HOSTS.has(url.hostname.toLowerCase());
}

/** True when this request may reach the API. See the module comment for why. */
export function isAllowedApiRequest({ method, host, origin }: ApiRequestInfo): boolean {
  if (!isLocalHost(host)) return false;
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  // Absent Origin means a non-browser client — no CSRF risk to defend against.
  if (origin === undefined || origin === null || origin === "") return true;
  return isAllowedOrigin(origin);
}
