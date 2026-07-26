// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { Settings } from "@offeros/core";
import { AiSettings } from "../ai-settings";
import { api, ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return {
    ...actual,
    api: {
      settings: {
        get: vi.fn(),
        save: vi.fn(),
        llmKeys: vi.fn(),
        setLlmKey: vi.fn(),
        testLlm: vi.fn(),
      },
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseSettings: Settings = {
  agent: {
    enableCustomizeResume: true,
    enableCustomizeCoverLetter: true,
    useOriginalResume: false,
    autoConfirm: false,
  },
  llm: {
    provider: "anthropic",
    model: undefined,
    promptOverrides: {},
    modelOverrides: {},
    apiKeys: {},
  },
};

const savedAnthropicOpenaiEnv: Record<string, "saved" | "env" | "none"> = {
  anthropic: "saved",
  openai: "env",
};

function mockLoad(
  settings: Settings = baseSettings,
  keys: Record<string, "saved" | "env" | "none"> = savedAnthropicOpenaiEnv,
) {
  vi.mocked(api.settings.get).mockResolvedValue(settings);
  vi.mocked(api.settings.llmKeys).mockResolvedValue(keys);
}

describe("AiSettings", () => {
  it("renders provider, model and per-provider key status from the loaded settings", async () => {
    mockLoad();
    render(<AiSettings />);

    expect(await screen.findByLabelText("Anthropic")).toHaveProperty("checked", true);
    expect(screen.getByLabelText("OpenAI")).toHaveProperty("checked", false);
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.getByText("Using environment variable")).toBeTruthy();
  });

  it("re-lists models when the provider is switched", async () => {
    mockLoad();
    render(<AiSettings />);
    await screen.findByLabelText("Anthropic");

    expect(screen.getByRole("option", { name: "Claude Sonnet 5" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "GPT-4o" })).toBeNull();

    fireEvent.click(screen.getByLabelText("OpenAI"));

    expect(screen.getByRole("option", { name: "GPT-4o" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Claude Sonnet 5" })).toBeNull();
  });

  it("saves provider and model through settings.save without any api key in the payload", async () => {
    mockLoad();
    vi.mocked(api.settings.save).mockResolvedValue({
      ...baseSettings,
      llm: { ...baseSettings.llm, provider: "openai", model: "gpt-4o" },
    });

    render(<AiSettings />);
    await screen.findByLabelText("Anthropic");

    fireEvent.click(screen.getByLabelText("OpenAI"));
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-4o" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.settings.save).toHaveBeenCalled());
    const payload = vi.mocked(api.settings.save).mock.calls[0]![0];
    expect(payload.llm.provider).toBe("openai");
    expect(payload.llm.model).toBe("gpt-4o");
    expect(payload).not.toHaveProperty("llm.apiKeys.anthropic");
    expect(JSON.stringify(payload)).not.toContain("sk-super-secret");
  });

  it("saves a typed key via setLlmKey, clears the draft, and never sends it through settings.save", async () => {
    mockLoad();
    vi.mocked(api.settings.setLlmKey).mockResolvedValue({ anthropic: "saved", openai: "env" });

    render(<AiSettings />);
    await screen.findByLabelText("Anthropic");

    const keyInput = screen.getByLabelText("Anthropic API key") as HTMLInputElement;
    expect(keyInput.type).toBe("password");
    expect(keyInput.value).toBe("");

    fireEvent.change(keyInput, { target: { value: "sk-super-secret" } });
    const row = within(keyInput.closest("div")!.parentElement as HTMLElement);
    fireEvent.click(row.getByRole("button", { name: "Save key" }));

    await waitFor(() =>
      expect(api.settings.setLlmKey).toHaveBeenCalledWith("anthropic", "sk-super-secret"),
    );
    expect(api.settings.save).not.toHaveBeenCalled();
    await waitFor(() =>
      expect((screen.getByLabelText("Anthropic API key") as HTMLInputElement).value).toBe(""),
    );
  });

  it("shows a Clear button only for a provider whose status is saved, and clears via setLlmKey", async () => {
    mockLoad();
    vi.mocked(api.settings.setLlmKey).mockResolvedValue({ anthropic: "none", openai: "env" });

    render(<AiSettings />);
    await screen.findByLabelText("Anthropic");

    // anthropic is "saved" -> has a Clear button; openai is "env" -> no Clear button for it.
    const clearButtons = screen.getAllByRole("button", { name: "Clear" });
    expect(clearButtons).toHaveLength(1);

    fireEvent.click(clearButtons[0]!);
    await waitFor(() => expect(api.settings.setLlmKey).toHaveBeenCalledWith("anthropic", ""));
  });

  it("tests the connection and shows an inline success result", async () => {
    mockLoad();
    vi.mocked(api.settings.testLlm).mockResolvedValue({ ok: true });

    render(<AiSettings />);
    await screen.findByLabelText("Anthropic");

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(api.settings.testLlm).toHaveBeenCalled());
    const call = vi.mocked(api.settings.testLlm).mock.calls[0]![0];
    expect(call.provider).toBe("anthropic");
    expect(call.key).toBeUndefined();
    expect(await screen.findByText(/connected/i)).toBeTruthy();
  });

  it("uses the draft key (not the stored one) when testing, and shows the caught error message", async () => {
    mockLoad();
    vi.mocked(api.settings.testLlm).mockRejectedValue(new ApiError("invalid api key", 400));

    render(<AiSettings />);
    await screen.findByLabelText("Anthropic");

    fireEvent.change(screen.getByLabelText("Anthropic API key"), {
      target: { value: "sk-draft-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(api.settings.testLlm).toHaveBeenCalled());
    const call = vi.mocked(api.settings.testLlm).mock.calls[0]![0];
    expect(call.key).toBe("sk-draft-key");
    expect(await screen.findByText("invalid api key")).toBeTruthy();
  });

  it("shows the trust note about local key storage", async () => {
    mockLoad();
    render(<AiSettings />);
    await screen.findByLabelText("Anthropic");

    expect(screen.getByText(/stored locally in ~\/.offeros/i)).toBeTruthy();
  });
});
