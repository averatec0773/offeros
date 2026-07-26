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

export function proxy(request: NextRequest) {
  const allowed = isAllowedApiRequest({
    method: request.method,
    host: request.headers.get("host"),
    origin: request.headers.get("origin"),
  });
  if (allowed) return NextResponse.next();
  return NextResponse.json(FORBIDDEN, { status: 403 });
}

export const config = {
  // Everything except static assets and the favicon: page routes are
  // force-dynamic server components that serialize DB data into the
  // HTML/RSC payload, so they need the same Host guard as the API. The
  // Origin gate only applies to mutating methods, so page GETs stay
  // Host-gated only.
  matcher: ["/((?!_next/static/|_next/image/|favicon\\.ico$).*)"],
};
