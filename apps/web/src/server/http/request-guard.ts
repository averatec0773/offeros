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
  /**
   * Extension ids the owner has allowlisted (from OFFEROS_ALLOWED_EXTENSION_IDS).
   * EMPTY/absent → any `chrome-extension://` origin is accepted, because a
   * side-loaded pre-alpha extension has no stable published id to pin yet. Once
   * ids are configured, only those pass — closing the "any installed extension
   * can read your data" gap from the 2026-08-10 security audit.
   */
  allowedExtensionIds?: readonly string[];
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

export function isAllowedOrigin(origin: string, allowedExtensionIds?: readonly string[]): boolean {
  // `Origin: null` is what sandboxed iframes and some cross-site redirects
  // send. It carries no provenance, so it never counts as local.
  if (origin === "null") return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol === EXTENSION_SCHEME) {
    // No allowlist configured → accept any extension (the pre-alpha default;
    // no stable published id exists to pin). Configured → only listed ids.
    // For a chrome-extension:// origin, url.hostname is the extension id.
    if (!allowedExtensionIds || allowedExtensionIds.length === 0) return true;
    return allowedExtensionIds.includes(url.hostname);
  }
  if (!LOCAL_ORIGIN_SCHEMES.has(url.protocol)) return false;
  return LOCAL_HOSTS.has(url.hostname.toLowerCase());
}

/** True when this request may reach the API. See the module comment for why. */
export function isAllowedApiRequest({
  method,
  host,
  origin,
  allowedExtensionIds,
}: ApiRequestInfo): boolean {
  if (!isLocalHost(host)) return false;
  const hasOrigin = origin !== undefined && origin !== null && origin !== "";
  // A browser extension always attaches its chrome-extension Origin, even on a
  // GET. If an allowlist is configured, check it regardless of method — the
  // read-path is where a hostile extension would exfiltrate PII, and exempting
  // it as a "safe method" was the compounding half of the audit's V1 finding.
  if (hasOrigin && origin!.startsWith(EXTENSION_SCHEME)) {
    return isAllowedOrigin(origin!, allowedExtensionIds);
  }
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  // Absent Origin means a non-browser client — no CSRF risk to defend against.
  if (!hasOrigin) return true;
  return isAllowedOrigin(origin!, allowedExtensionIds);
}
