import { afterEach, describe, expect, it, vi } from "vitest";
import { chromiumLaunchOptions, renderHtmlToPdf } from "../chromium-pdf";

// `renderHtmlToPdf` does `const { chromium } = await import("playwright")`
// internally — a dynamic import, but vi.mock intercepts it the same as a
// static one, so this fake stands in for the real browser.
const launchCalls: unknown[] = [];

vi.mock("playwright", () => ({
  chromium: {
    launch: async (options: unknown) => {
      launchCalls.push(options);
      return {
        newPage: async () => ({
          setContent: async () => {},
          pdf: async () => Buffer.from("fake-pdf-bytes"),
        }),
        close: async () => {},
      };
    },
  },
}));

describe("chromiumLaunchOptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("launches headless with a minimal env that carries no provider API keys", () => {
    vi.stubEnv("PATH", "/usr/bin:/bin");
    vi.stubEnv("HOME", "/Users/test");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-leak");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-leak");
    vi.stubEnv("TMPDIR", undefined as unknown as string);
    delete process.env.TMPDIR;

    const opts = chromiumLaunchOptions();
    expect(opts.headless).toBe(true);
    expect(opts.env).toEqual({ PATH: "/usr/bin:/bin", HOME: "/Users/test" });
  });

  it("carries TMPDIR through only when it is set in the parent env", () => {
    vi.stubEnv("PATH", "/usr/bin:/bin");
    vi.stubEnv("HOME", "/Users/test");
    vi.stubEnv("TMPDIR", "/private/tmp/scratch");

    const opts = chromiumLaunchOptions();
    expect(opts.env).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/Users/test",
      TMPDIR: "/private/tmp/scratch",
    });
  });

  it("never includes any *_API_KEY regardless of what the parent env carries", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-leak");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-leak");
    vi.stubEnv("SOME_OTHER_API_KEY", "leak-too");

    const opts = chromiumLaunchOptions();
    const keys = Object.keys(opts.env ?? {});
    expect(keys.some((k) => k.includes("API_KEY"))).toBe(false);
  });
});

describe("renderHtmlToPdf chromium launch wiring", () => {
  afterEach(() => {
    launchCalls.length = 0;
    vi.unstubAllEnvs();
  });

  // Regression guard: if chromium-pdf.ts:44 ever reverts to a bare
  // `chromium.launch({ headless: true })` (dropping the minimal-env options),
  // the captured launch options here stop matching chromiumLaunchOptions()
  // and this test fails.
  it("launches chromium with exactly chromiumLaunchOptions() — no provider keys reach the subprocess env", async () => {
    vi.stubEnv("PATH", "/usr/bin:/bin");
    vi.stubEnv("HOME", "/Users/test");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-leak");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-leak");

    const result = await renderHtmlToPdf("<html></html>");
    expect(result.ok).toBe(true);

    expect(launchCalls).toHaveLength(1);
    expect(launchCalls[0]).toEqual(chromiumLaunchOptions());

    const env = (launchCalls[0] as { env?: Record<string, string> }).env ?? {};
    expect(Object.keys(env).some((k) => k.includes("API_KEY"))).toBe(false);
  });
});
