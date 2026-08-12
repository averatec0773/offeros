import { describe, it, expect, vi } from "vitest";
import { isPrivateAddress, isPublicHost, safeFetch, safeFetchText } from "../safe-fetch";

/**
 * This app runs on someone's laptop, behind their router, beside things that
 * trust the local network. Fetching a URL a job board handed us must never
 * become a way to reach any of that.
 */

const publicDns = async () => ["93.184.216.34"];
const privateDns = async () => ["127.0.0.1"];

function reply(
  init: { status?: number; headers?: Record<string, string>; body?: string } = {},
): Response {
  const headers = new Headers(init.headers ?? {});
  return {
    status: init.status ?? 200,
    headers,
    arrayBuffer: async () => new TextEncoder().encode(init.body ?? "hello").buffer,
  } as unknown as Response;
}

describe("isPrivateAddress", () => {
  it("refuses every range that means 'our own network'", () => {
    for (const address of [
      "127.0.0.1",
      "127.53.1.9",
      "0.0.0.0",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // carrier-grade NAT
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "::ffff:127.0.0.1", // v4-mapped loopback
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const address of [
      "93.184.216.34",
      "8.8.8.8",
      "172.32.0.1",
      "172.15.0.1",
      "2606:4700::1",
    ]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});

describe("isPublicHost", () => {
  it("refuses the literal local names without resolving anything", async () => {
    for (const name of ["localhost", "LOCALHOST", "127.0.0.1", "[::1]"]) {
      const result = await isPublicHost(name, async () => {
        throw new Error("should not resolve");
      });
      expect(result.ok, name).toBe(false);
    }
  });

  it("refuses a public NAME that resolves somewhere private", async () => {
    // The bypass the literal check alone would miss.
    const result = await isPublicHost("totally-fine.example", privateDns);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/resolves to a private address/);
  });

  it("refuses a name that will not resolve — we cannot vouch for it", async () => {
    const result = await isPublicHost("nowhere.example", async () => []);
    expect(result.ok).toBe(false);
  });

  it("allows an ordinary host", async () => {
    expect((await isPublicHost("boards.example.com", publicDns)).ok).toBe(true);
  });
});

describe("safeFetch", () => {
  it("fetches an ordinary page", async () => {
    const result = await safeFetch("https://jobs.example.com/x", {
      fetchImpl: vi.fn(async () => reply({ body: "page" })) as never,
      resolve: publicDns,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(new TextDecoder().decode(result.bytes)).toBe("page");
  });

  it("re-checks the host on EVERY redirect hop", async () => {
    // The whole reason redirects are followed by hand: a job board's own link
    // 301s to the employer's domain, so only checking the first URL would
    // validate a host we never actually talk to — and would let a public host
    // bounce us straight into the private network.
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("start")
        ? reply({ status: 301, headers: { location: "http://169.254.169.254/latest/meta-data" } })
        : reply({ body: "secrets" }),
    );
    const resolve = async (host: string) =>
      host === "start.example" ? ["93.184.216.34"] : ["169.254.169.254"];

    const result = await safeFetch("https://start.example/x", {
      fetchImpl: fetchImpl as never,
      resolve,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/private address/);
    // It never issued the second request.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("follows a legitimate cross-host redirect and reports where it landed", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("board.example")
        ? reply({ status: 301, headers: { location: "https://employer.example/careers/apply" } })
        : reply({ body: "the posting" }),
    );
    const result = await safeFetch("https://board.example/jobs/1", {
      fetchImpl: fetchImpl as never,
      resolve: publicDns,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.finalUrl).toBe("https://employer.example/careers/apply");
  });

  it("gives up rather than looping forever", async () => {
    const fetchImpl = vi.fn(async () =>
      reply({ status: 302, headers: { location: "https://loop.example/next" } }),
    );
    const result = await safeFetch("https://loop.example/start", {
      fetchImpl: fetchImpl as never,
      resolve: publicDns,
      maxRedirects: 3,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/too many redirects/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("refuses a body that is over the ceiling, declared or actual", async () => {
    const declared = await safeFetch("https://jobs.example.com/x", {
      fetchImpl: vi.fn(async () => reply({ headers: { "content-length": "99999999" } })) as never,
      resolve: publicDns,
      maxBytes: 1000,
    });
    expect(declared.ok).toBe(false);

    const actual = await safeFetch("https://jobs.example.com/x", {
      fetchImpl: vi.fn(async () => reply({ body: "x".repeat(5000) })) as never,
      resolve: publicDns,
      maxBytes: 1000,
    });
    expect(actual.ok).toBe(false);
    if (!actual.ok) expect(actual.reason).toMatch(/too large/);
  });

  it("allows a response that declares no content type at all", async () => {
    // Absence is not a mismatch, and real servers omit it.
    const result = await safeFetch("https://jobs.example.com/x", {
      fetchImpl: vi.fn(async () => reply({ body: "page" })) as never,
      resolve: publicDns,
      accept: ["text/html"],
    });
    expect(result.ok).toBe(true);
  });

  it("enforces the content type when one is required", async () => {
    const result = await safeFetch("https://jobs.example.com/x", {
      fetchImpl: vi.fn(async () =>
        reply({ headers: { "content-type": "application/pdf" } }),
      ) as never,
      resolve: publicDns,
      accept: ["text/html"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unexpected content type/);
  });

  it("refuses a scheme that is not http(s)", async () => {
    const fetchImpl = vi.fn();
    for (const url of ["file:///etc/passwd", "ftp://x.example/y", "data:text/html,hi"]) {
      const result = await safeFetch(url, { fetchImpl: fetchImpl as never, resolve: publicDns });
      expect(result.ok, url).toBe(false);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a refusal rather than throwing when the host is hostile", async () => {
    const result = await safeFetch("https://jobs.example.com/x", {
      fetchImpl: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as never,
      resolve: publicDns,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/could not reach it/);
  });

  it("sends no browser disguise — no spoofed User-Agent", async () => {
    // Not an oversight. When a site will not serve a server, the honest answer
    // is that the browser can see it and we cannot.
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.stringify(init?.headers ?? {})).not.toMatch(/mozilla|chrome|safari/i);
      return reply({ body: "ok" });
    });
    await safeFetch("https://jobs.example.com/x", {
      fetchImpl: fetchImpl as never,
      resolve: publicDns,
    });
    expect(fetchImpl).toHaveBeenCalled();
  });
});

describe("safeFetchText", () => {
  it("decodes the body and carries the final URL", async () => {
    const result = await safeFetchText("https://jobs.example.com/x", {
      fetchImpl: vi.fn(async () => reply({ body: "<html>hi</html>" })) as never,
      resolve: publicDns,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("<html>hi</html>");
      expect(result.status).toBe(200);
    }
  });

  it("passes a refusal straight through", async () => {
    const result = await safeFetchText("https://internal.example/x", {
      fetchImpl: vi.fn() as never,
      resolve: privateDns,
    });
    expect(result.ok).toBe(false);
  });
});
