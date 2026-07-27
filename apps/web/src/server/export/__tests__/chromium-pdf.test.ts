import { afterEach, describe, expect, it, vi } from "vitest";
import { chromiumLaunchOptions } from "../chromium-pdf";

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
