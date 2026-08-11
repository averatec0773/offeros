import { NextResponse, type NextRequest } from "next/server";
import { isAllowedApiRequest } from "@/server/http/request-guard";

/**
 * Rejects any API request that did not come from this machine.
 *
 * Middleware runs on the edge runtime, so this file must stay free of
 * Node-only imports (`better-sqlite3`, `node:fs`, the repositories, and the
 * `envelope` helper that pulls in zod). The envelope shape is therefore
 * written out inline — it must stay in sync with
 * `src/server/http/envelope.ts`.
 */
const FORBIDDEN = {
  success: false,
  errorCode: 40300,
  errorMsg: "forbidden: non-local request",
  result: null,
};

/** Optional owner allowlist of extension ids. Empty = accept any extension
 *  origin (pre-alpha default). Set OFFEROS_ALLOWED_EXTENSION_IDS to a
 *  comma-separated list once the extension has a stable published id. */
const ALLOWED_EXTENSION_IDS = (process.env.OFFEROS_ALLOWED_EXTENSION_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function proxy(request: NextRequest) {
  const allowed = isAllowedApiRequest({
    method: request.method,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
    allowedExtensionIds: ALLOWED_EXTENSION_IDS,
  });
  if (allowed) return NextResponse.next();
  return NextResponse.json(FORBIDDEN, { status: 403 });
}

export default proxy;

export const config = {
  // Everything except static assets and the favicon: page routes are
  // force-dynamic server components that serialize DB data into the
  // HTML/RSC payload, so they need the same Host guard as the API. The
  // Origin gate only applies to mutating methods, so page GETs stay
  // Host-gated only.
  matcher: ["/((?!_next/static/|_next/image/|favicon\\.ico$).*)"],
};
