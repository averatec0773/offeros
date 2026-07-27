import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import proxyDefault, { proxy, config } from "../proxy";

// Pins the loopback/Origin security layer (proxy.ts + request-guard.ts)
// against silent breakage from a Next.js upgrade. If this literal legitimately
// needs to change (e.g. widening/narrowing which paths are Host-gated), update
// it deliberately here alongside the change in ../proxy.ts.
const KNOWN_GOOD_MATCHER = ["/((?!_next/static/|_next/image/|favicon\\.ico$).*)"];

describe("proxy contract", () => {
  // Pins BOTH exports: Next.js's middleware convention prefers the default
  // export, so removing the named `proxy` export alone would fail loudly
  // here instead of silently breaking a caller that imports it by name.
  it("exports both a named `proxy` and a default export, and they are the same function", () => {
    expect(typeof proxy).toBe("function");
    expect(typeof proxyDefault).toBe("function");
    expect(proxy).toBe(proxyDefault);
  });

  it("pins the matcher to the current known-good value", () => {
    expect(config.matcher).toEqual(KNOWN_GOOD_MATCHER);
  });

  it("rejects a non-loopback Host with the 40300 forbidden envelope", async () => {
    const req = new NextRequest("http://evil.example/api/v1/settings", {
      headers: { host: "evil.example" },
    });
    const res = proxy(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      errorCode: 40300,
      errorMsg: "forbidden: non-local request",
      result: null,
    });
  });

  it("allows a loopback Host through", () => {
    const req = new NextRequest("http://localhost/api/v1/settings", {
      headers: { host: "localhost:3000" },
    });
    const res = proxy(req);
    expect(res.status).toBe(200);
  });
});
