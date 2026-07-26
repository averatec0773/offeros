import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { LlmError, type ProviderCallArgs } from "@offeros/llm";

const dir = mkdtempSync(join(tmpdir(), "offeros-settings-route-"));
process.env.OFFEROS_DB_PATH = join(dir, "route.db");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const callProviderMock = vi.fn<(...args: unknown[]) => Promise<string>>();
vi.mock("@offeros/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@offeros/llm")>();
  return {
    ...actual,
    callProvider: (...args: unknown[]) => callProviderMock(...args),
  };
});

const settingsRoute = await import("../settings/route");
const llmKeysRoute = await import("../settings/llm-keys/route");
const testLlmRoute = await import("../settings/test-llm/route");

afterEach(() => {
  vi.unstubAllEnvs();
  callProviderMock.mockReset();
});

const req = (method: string, body?: unknown) =>
  new Request("http://localhost", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const clearKey = (provider: "anthropic" | "openai") =>
  llmKeysRoute.PUT(req("PUT", { provider, key: "" }));

describe("/api/v1/settings", () => {
  it("GET never includes llm.apiKeys", async () => {
    const res = await (await settingsRoute.GET()).json();
    expect(res.success).toBe(true);
    expect(res.result.llm).not.toHaveProperty("apiKeys");
  });

  it("PUT ignores a client-sent apiKeys and preserves the stored key", async () => {
    // Seed a stored key via the llm-keys route (the only legitimate writer).
    await llmKeysRoute.PUT(req("PUT", { provider: "openai", key: "real-key" }));

    const settingsBody = await (await settingsRoute.GET()).json();
    const put = await settingsRoute.PUT(
      req("PUT", {
        ...settingsBody.result,
        llm: { ...settingsBody.result.llm, apiKeys: { openai: "HACK" } },
      }),
    );
    const putJson = await put.json();
    expect(putJson.success).toBe(true);
    // The PUT response itself must never leak keys either.
    expect(putJson.result.llm).not.toHaveProperty("apiKeys");

    const status = await (await llmKeysRoute.GET()).json();
    expect(status.result.openai).toBe("saved");

    // A direct test-llm call resolves to the untouched stored key, not "HACK".
    callProviderMock.mockResolvedValue("OK");
    await testLlmRoute.POST(req("POST", { provider: "openai" }));
    const args = callProviderMock.mock.calls[0]![1] as ProviderCallArgs;
    expect(args.key).toBe("real-key");

    await clearKey("openai");
  });
});

describe("/api/v1/settings/llm-keys", () => {
  it("GET reports 'saved' when a key is stored, even with an env var also set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "env-key");
    await llmKeysRoute.PUT(req("PUT", { provider: "anthropic", key: "saved-key" }));

    const res = await (await llmKeysRoute.GET()).json();
    expect(res.result.anthropic).toBe("saved");

    await clearKey("anthropic");
  });

  it("GET reports 'env' when nothing is stored but the env var is set", async () => {
    await clearKey("anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "env-key");

    const res = await (await llmKeysRoute.GET()).json();
    expect(res.result.anthropic).toBe("env");
  });

  it("GET reports 'none' when neither stored nor env is set", async () => {
    await clearKey("anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const res = await (await llmKeysRoute.GET()).json();
    expect(res.result.anthropic).toBe("none");
  });

  it("PUT sets a key then clears it with an empty string", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const set = await (
      await llmKeysRoute.PUT(req("PUT", { provider: "anthropic", key: "abc123" }))
    ).json();
    expect(set.result.anthropic).toBe("saved");

    const cleared = await (await clearKey("anthropic")).json();
    expect(cleared.result.anthropic).toBe("none");
  });

  it("PUT never echoes the raw key back", async () => {
    const res = await (
      await llmKeysRoute.PUT(req("PUT", { provider: "anthropic", key: "super-secret" }))
    ).json();
    expect(JSON.stringify(res.result)).not.toContain("super-secret");

    await clearKey("anthropic");
  });

  it("PUT trims whitespace so a padded key is stored and used identically to its trimmed form", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const set = await (
      await llmKeysRoute.PUT(req("PUT", { provider: "anthropic", key: "  sk-x\n" }))
    ).json();
    expect(set.result.anthropic).toBe("saved");

    callProviderMock.mockResolvedValue("OK");
    await testLlmRoute.POST(req("POST", { provider: "anthropic" }));
    const args = callProviderMock.mock.calls[0]![1] as ProviderCallArgs;
    expect(args.key).toBe("sk-x");

    await clearKey("anthropic");
  });
});

describe("/api/v1/settings/test-llm", () => {
  it("ok path returns { ok: true }", async () => {
    callProviderMock.mockResolvedValue("OK");
    const res = await (
      await testLlmRoute.POST(req("POST", { provider: "anthropic", key: "k" }))
    ).json();
    expect(res.success).toBe(true);
    expect(res.result).toEqual({ ok: true });
  });

  it("a thrown LlmError (e.g. no_key) surfaces as a plain 400, not 42000", async () => {
    callProviderMock.mockRejectedValue(new LlmError("no_key", "No API key configured."));
    const res = await testLlmRoute.POST(req("POST", { provider: "anthropic" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errorCode).toBe(40000);
    expect(json.errorMsg).toBe("No API key configured.");
  });

  it("resolves key precedence: body.key, then stored, then env", async () => {
    await clearKey("anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "env-anthropic");
    await llmKeysRoute.PUT(req("PUT", { provider: "anthropic", key: "stored-anthropic" }));
    callProviderMock.mockResolvedValue("OK");

    await testLlmRoute.POST(req("POST", { provider: "anthropic", key: "body-anthropic" }));
    expect((callProviderMock.mock.calls[0]![1] as ProviderCallArgs).key).toBe("body-anthropic");

    callProviderMock.mockReset();
    callProviderMock.mockResolvedValue("OK");
    await testLlmRoute.POST(req("POST", { provider: "anthropic" }));
    expect((callProviderMock.mock.calls[0]![1] as ProviderCallArgs).key).toBe("stored-anthropic");

    await clearKey("anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "env-anthropic");
    callProviderMock.mockReset();
    callProviderMock.mockResolvedValue("OK");
    await testLlmRoute.POST(req("POST", { provider: "anthropic" }));
    expect((callProviderMock.mock.calls[0]![1] as ProviderCallArgs).key).toBe("env-anthropic");

    await clearKey("anthropic");
  });

  it("trims a whitespace-padded body.key before falling back to it", async () => {
    await clearKey("anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    callProviderMock.mockResolvedValue("OK");

    await testLlmRoute.POST(req("POST", { provider: "anthropic", key: "  sk-body  " }));
    expect((callProviderMock.mock.calls[0]![1] as ProviderCallArgs).key).toBe("sk-body");
  });

  it("resolves the model through resolveModel, so a cross-provider model becomes undefined", async () => {
    callProviderMock.mockResolvedValue("OK");
    await testLlmRoute.POST(req("POST", { provider: "anthropic", model: "gpt-4o", key: "k" }));
    const args = callProviderMock.mock.calls[0]![1] as ProviderCallArgs;
    expect(args.model).toBeUndefined();
  });

  it("passes through a model that belongs to the given provider", async () => {
    callProviderMock.mockResolvedValue("OK");
    await testLlmRoute.POST(
      req("POST", { provider: "anthropic", model: "claude-sonnet-5", key: "k" }),
    );
    const args = callProviderMock.mock.calls[0]![1] as ProviderCallArgs;
    expect(args.model).toBe("claude-sonnet-5");
  });
});
