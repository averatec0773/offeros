import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "offeros-logo-"));
  process.env.OFFEROS_DB_PATH = join(dir, "t.db");
  vi.resetModules();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const publicDns = async () => ["93.184.216.34"];

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function respond(bytes: Uint8Array, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 404,
    headers: new Headers(),
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

describe("cacheLogo", () => {
  it("fetches the favicon from the EMPLOYER's own host, never a logo service", async () => {
    const { cacheLogo } = await import("../logo-service");
    const fetchImpl = vi.fn(async (_url: string, _init?: unknown) => respond(PNG));
    const stored = await cacheLogo(
      "app-1",
      "https://boards.acme.com/jobs/1",
      fetchImpl as never,
      publicDns,
    );

    expect(stored).toBe(true);
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toBe("https://boards.acme.com/favicon.ico");
    // Handing a third party the list of companies someone applies to is the
    // exact profile this app exists not to build.
    expect(url).not.toMatch(/google|duckduckgo|clearbit|favicone/i);
  });

  it("stores it under the application id, so no path can come from input", async () => {
    const { cacheLogo, getLogo } = await import("../logo-service");
    await cacheLogo("app-1", "https://acme.com/x", vi.fn(async () => respond(PNG)) as never);
    expect(getLogo("app-1")!.filePath).toMatch(/logos\/app-1\.png$/);
  });

  it("refuses an id that is not id-shaped", async () => {
    const { cacheLogo, getLogo } = await import("../logo-service");
    const fetchImpl = vi.fn(async () => respond(PNG));
    expect(
      await cacheLogo("../../etc/passwd", "https://acme.com/x", fetchImpl as never, publicDns),
    ).toBe(false);
    expect(getLogo("../../etc/passwd")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps only real images, judged by their bytes rather than a header", async () => {
    const { cacheLogo } = await import("../logo-service");
    const html = new Uint8Array([0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45]);
    // A site that answers 200 with its 404 page must not become a "logo".
    expect(
      await cacheLogo("app-2", "https://acme.com/x", vi.fn(async () => respond(html)) as never),
    ).toBe(false);
  });

  it("refuses an SVG — it is a document that can carry script", async () => {
    const { cacheLogo } = await import("../logo-service");
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(
      await cacheLogo("app-3", "https://acme.com/x", vi.fn(async () => respond(svg)) as never),
    ).toBe(false);
  });

  it("refuses anything oversized", async () => {
    const { cacheLogo } = await import("../logo-service");
    const huge = new Uint8Array(600 * 1024);
    huge.set(PNG.slice(0, 8));
    expect(
      await cacheLogo("app-4", "https://acme.com/x", vi.fn(async () => respond(huge)) as never),
    ).toBe(false);
  });

  it("never throws or retries when the host is hostile", async () => {
    const { cacheLogo } = await import("../logo-service");
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await cacheLogo("app-5", "https://acme.com/x", fetchImpl as never, publicDns)).toBe(
      false,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not re-fetch one it already has", async () => {
    const { cacheLogo, logosDir } = await import("../logo-service");
    mkdirSync(logosDir(), { recursive: true });
    writeFileSync(join(logosDir(), "app-6.png"), PNG);
    const fetchImpl = vi.fn(async () => respond(PNG));
    expect(await cacheLogo("app-6", "https://acme.com/x", fetchImpl as never, publicDns)).toBe(
      true,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ignores a URL that is not http(s)", async () => {
    const { cacheLogo } = await import("../logo-service");
    const fetchImpl = vi.fn(async () => respond(PNG));
    expect(await cacheLogo("app-7", "file:///etc/passwd", fetchImpl as never, publicDns)).toBe(
      false,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("readLogo", () => {
  it("returns nothing when none was ever stored", async () => {
    const { readLogo } = await import("../logo-service");
    expect(readLogo("app-none")).toBeNull();
  });

  it("returns the bytes and the type it sniffed at write time", async () => {
    const { cacheLogo, readLogo } = await import("../logo-service");
    await cacheLogo("app-8", "https://acme.com/x", vi.fn(async () => respond(PNG)) as never);
    const read = readLogo("app-8")!;
    expect(read.mime).toBe("image/png");
    expect(read.bytes.length).toBe(PNG.length);
  });

  it("refuses a traversal attempt outright", async () => {
    const { readLogo, logosDir } = await import("../logo-service");
    mkdirSync(logosDir(), { recursive: true });
    const outside = join(dir, "secret.png");
    writeFileSync(outside, PNG);
    expect(existsSync(outside)).toBe(true);
    expect(readLogo("../secret")).toBeNull();
    expect(readLogo("..%2Fsecret")).toBeNull();
  });
});
