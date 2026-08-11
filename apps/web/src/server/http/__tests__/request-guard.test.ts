import { describe, expect, it } from "vitest";
import { isAllowedApiRequest, isAllowedOrigin, isLocalHost } from "../request-guard";

const allow = (info: Parameters<typeof isAllowedApiRequest>[0]) => isAllowedApiRequest(info);

describe("isLocalHost", () => {
  it("accepts the three loopback names, with or without a port", () => {
    for (const host of [
      "localhost",
      "localhost:3000",
      "LOCALHOST:3000",
      "127.0.0.1",
      "127.0.0.1:8080",
      "[::1]",
      "[::1]:3000",
    ]) {
      expect(isLocalHost(host), host).toBe(true);
    }
  });

  it("rejects every non-loopback host", () => {
    for (const host of [
      "evil.com",
      "evil.com:3000",
      "localhost.evil.com",
      "notlocalhost",
      "192.168.1.10:3000",
      "127.0.0.1.evil.com",
      "[::2]:3000",
      "0.0.0.0:3000",
    ]) {
      expect(isLocalHost(host), host).toBe(false);
    }
  });

  it("rejects a missing or empty host", () => {
    expect(isLocalHost(undefined)).toBe(false);
    expect(isLocalHost(null)).toBe(false);
    expect(isLocalHost("")).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("accepts loopback http/https origins on any port", () => {
    for (const origin of [
      "http://localhost:3000",
      "http://localhost",
      "https://localhost:3000",
      "http://127.0.0.1:3000",
      "https://127.0.0.1",
      "http://[::1]:3000",
    ]) {
      expect(isAllowedOrigin(origin), origin).toBe(true);
    }
  });

  it("accepts any chrome-extension origin when no allowlist is configured", () => {
    expect(isAllowedOrigin("chrome-extension://abcdefghijklmnopabcdefghijklmnop")).toBe(true);
  });

  it("with an allowlist, accepts only listed extension ids", () => {
    const allow = ["goodidgoodidgoodidgoodidgoodid00"];
    expect(isAllowedOrigin("chrome-extension://goodidgoodidgoodidgoodidgoodid00", allow)).toBe(
      true,
    );
    expect(isAllowedOrigin("chrome-extension://evilidevilidevilidevilidevilid00", allow)).toBe(
      false,
    );
    // An empty allowlist stays permissive (pre-alpha default).
    expect(isAllowedOrigin("chrome-extension://anything", [])).toBe(true);
  });

  it("rejects scheme confusion around the chrome-extension check", () => {
    for (const origin of ["https://chrome-extension.evil.com", "chrome-extension-x://foo"]) {
      expect(isAllowedOrigin(origin), origin).toBe(false);
    }
    expect(isAllowedOrigin("chrome-extension://abcdef")).toBe(true);
  });

  it("rejects remote, non-http and malformed origins", () => {
    for (const origin of [
      "https://evil.com",
      "http://evil.com:3000",
      "http://localhost.evil.com",
      "ftp://localhost",
      "file://",
      "null",
      "not a url",
      "",
    ]) {
      expect(isAllowedOrigin(origin), origin).toBe(false);
    }
  });
});

describe("isAllowedApiRequest", () => {
  it("allows loopback reads regardless of origin", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(allow({ method, host: "localhost:3000", origin: "https://evil.com" }), method).toBe(
        true,
      );
    }
  });

  it("rejects any non-loopback host, even for reads", () => {
    expect(allow({ method: "GET", host: "evil.com", origin: null })).toBe(false);
    expect(allow({ method: "POST", host: "evil.com", origin: "http://localhost:3000" })).toBe(
      false,
    );
    expect(allow({ method: "GET", host: undefined })).toBe(false);
  });

  it("allows mutating requests with no Origin (curl, scripts)", () => {
    for (const origin of [undefined, null, ""]) {
      expect(allow({ method: "POST", host: "127.0.0.1:3000", origin })).toBe(true);
    }
  });

  it("allows the web UI's own same-origin writes", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(
        allow({ method, host: "localhost:3000", origin: "http://localhost:3000" }),
        method,
      ).toBe(true);
    }
  });

  it("allows the extension's writes", () => {
    expect(
      allow({
        method: "POST",
        host: "127.0.0.1:3000",
        origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      }),
    ).toBe(true);
  });

  it("with an allowlist, blocks an unlisted extension even on a GET (read-path)", () => {
    const allowedExtensionIds = ["goodidgoodidgoodidgoodidgoodid00"];
    // The audit's V1: a hostile extension reading PII via a safe method.
    expect(
      allow({
        method: "GET",
        host: "127.0.0.1:3000",
        origin: "chrome-extension://evilidevilidevilidevilidevilid00",
        allowedExtensionIds,
      }),
    ).toBe(false);
    // The allowlisted extension still gets through, GET or write.
    expect(
      allow({
        method: "GET",
        host: "127.0.0.1:3000",
        origin: "chrome-extension://goodidgoodidgoodidgoodidgoodid00",
        allowedExtensionIds,
      }),
    ).toBe(true);
    // A non-extension GET is unaffected by the extension allowlist.
    expect(
      allow({ method: "GET", host: "127.0.0.1:3000", allowedExtensionIds, origin: undefined }),
    ).toBe(true);
  });

  it("rejects cross-site writes", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(allow({ method, host: "localhost:3000", origin: "https://evil.com" }), method).toBe(
        false,
      );
    }
  });

  it("rejects an opaque `null` Origin on writes", () => {
    expect(allow({ method: "POST", host: "localhost:3000", origin: "null" })).toBe(false);
  });

  it("rejects chrome-extension scheme confusion on writes", () => {
    expect(
      allow({
        method: "POST",
        host: "localhost:3000",
        origin: "https://chrome-extension.evil.com",
      }),
    ).toBe(false);
    expect(
      allow({ method: "POST", host: "localhost:3000", origin: "chrome-extension-x://foo" }),
    ).toBe(false);
    expect(
      allow({ method: "POST", host: "localhost:3000", origin: "chrome-extension://abcdef" }),
    ).toBe(true);
  });

  it("treats an unknown method as mutating", () => {
    expect(allow({ method: "PURGE", host: "localhost:3000", origin: "https://evil.com" })).toBe(
      false,
    );
  });
});
