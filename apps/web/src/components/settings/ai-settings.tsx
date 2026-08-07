"use client";

import { useEffect, useState } from "react";
import { modelsFor, LLM_PROVIDERS, type LlmProvider } from "@offeros/llm";
import { api, ApiError, type ClientSettings } from "@/lib/api-client";

type KeyStatus = "saved" | "env" | "none";

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

const PROVIDERS: { id: LlmProvider; label: string }[] = LLM_PROVIDERS.map((id) => ({
  id,
  label: PROVIDER_LABELS[id],
}));

const STATUS_LABEL: Record<KeyStatus, string> = {
  saved: "Saved",
  env: "Using environment variable",
  none: "Not set",
};

type TestResult = { ok: true } | { ok: false; message: string };

export function AiSettings() {
  const [settings, setSettings] = useState<ClientSettings | null>(null);
  const [keyStatus, setKeyStatus] = useState<Record<string, KeyStatus> | null>(null);

  const [providerDraft, setProviderDraft] = useState<LlmProvider>("anthropic");
  const [modelDraft, setModelDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  const [keyDrafts, setKeyDrafts] = useState<Record<LlmProvider, string>>({
    anthropic: "",
    openai: "",
  });
  const [keyBusy, setKeyBusy] = useState<Record<LlmProvider, boolean>>({
    anthropic: false,
    openai: false,
  });
  const [keyErrors, setKeyErrors] = useState<Record<LlmProvider, string | null>>({
    anthropic: null,
    openai: null,
  });

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  function load() {
    setLoadError(null);
    Promise.all([api.settings.get(), api.settings.llmKeys()])
      .then(([s, keys]) => {
        setSettings(s);
        setProviderDraft(s.llm.provider);
        setModelDraft(s.llm.model ?? "");
        setKeyStatus(keys);
      })
      .catch(() => setLoadError("Couldn't load settings."));
  }

  useEffect(() => {
    load();
  }, []);

  async function saveProviderModel() {
    if (!settings) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const next: ClientSettings = {
        ...settings,
        llm: {
          ...settings.llm,
          provider: providerDraft,
          model: modelDraft.trim() === "" ? undefined : modelDraft,
        },
      };
      const result = await api.settings.save(next);
      setSettings(result);
      setProviderDraft(result.llm.provider);
      setModelDraft(result.llm.model ?? "");
      setSaved(true);
    } catch {
      setSaveError("Couldn't save settings. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function saveKey(provider: LlmProvider) {
    setKeyBusy((b) => ({ ...b, [provider]: true }));
    setKeyErrors((e) => ({ ...e, [provider]: null }));
    try {
      const status = await api.settings.setLlmKey(provider, keyDrafts[provider]);
      setKeyStatus(status);
      setKeyDrafts((d) => ({ ...d, [provider]: "" }));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Couldn't save the key. Try again.";
      setKeyErrors((e) => ({ ...e, [provider]: message }));
    } finally {
      setKeyBusy((b) => ({ ...b, [provider]: false }));
    }
  }

  async function clearKey(provider: LlmProvider) {
    setKeyBusy((b) => ({ ...b, [provider]: true }));
    setKeyErrors((e) => ({ ...e, [provider]: null }));
    try {
      const status = await api.settings.setLlmKey(provider, "");
      setKeyStatus(status);
      setKeyDrafts((d) => ({ ...d, [provider]: "" }));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Couldn't clear the key. Try again.";
      setKeyErrors((e) => ({ ...e, [provider]: message }));
    } finally {
      setKeyBusy((b) => ({ ...b, [provider]: false }));
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const draftKey = keyDrafts[providerDraft].trim();
      await api.settings.testLlm({
        provider: providerDraft,
        model: modelDraft.trim() === "" ? undefined : modelDraft,
        key: draftKey === "" ? undefined : draftKey,
      });
      setTestResult({ ok: true });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Couldn't reach the provider.";
      setTestResult({ ok: false, message });
    } finally {
      setTesting(false);
    }
  }

  if (!settings || !keyStatus) {
    if (loadError) {
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-caption text-destructive">{loadError}</p>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center rounded-full bg-muted px-3 py-1.5 text-caption font-medium text-muted-foreground transition-colors hover:bg-secondary"
          >
            Retry
          </button>
        </div>
      );
    }
    return <p className="text-body text-muted-foreground">Loading…</p>;
  }

  const models = modelsFor(providerDraft);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-title font-semibold text-foreground">Provider</h2>
        <div className="mt-3 flex items-center gap-5">
          {PROVIDERS.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-2 text-body text-foreground"
              htmlFor={`provider-${p.id}`}
            >
              <input
                id={`provider-${p.id}`}
                type="radio"
                name="provider"
                checked={providerDraft === p.id}
                onChange={() => {
                  setProviderDraft(p.id);
                  setModelDraft("");
                  setSaved(false);
                }}
              />
              {p.label}
            </label>
          ))}
        </div>

        <div className="mt-4">
          <label htmlFor="ai-model" className="text-caption font-medium text-muted-foreground">
            Model
          </label>
          <select
            id="ai-model"
            value={modelDraft}
            onChange={(e) => {
              setModelDraft(e.target.value);
              setSaved(false);
            }}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-body text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Provider default</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {saveError && <p className="mt-3 text-caption text-destructive">{saveError}</p>}

        <div className="mt-4 flex items-center justify-end gap-3">
          {saved && <span className="text-caption text-muted-foreground">Saved.</span>}
          <button
            type="button"
            onClick={saveProviderModel}
            disabled={saving}
            className="inline-flex items-center rounded-full bg-primary px-4 py-2 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {PROVIDERS.map((p) => {
        const status = keyStatus[p.id] ?? "none";
        const busy = keyBusy[p.id];
        return (
          <div key={p.id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-body font-semibold text-foreground">{p.label} API key</h3>
              <span
                title={
                  status === "env"
                    ? "A key was found in the server environment (e.g. apps/web/.env.local). Saving a key here overrides it."
                    : undefined
                }
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-caption font-semibold ${
                  status === "saved"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {STATUS_LABEL[status]}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input
                type="password"
                autoComplete="off"
                aria-label={`${p.label} API key`}
                placeholder="Paste a new key…"
                value={keyDrafts[p.id]}
                onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-body text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => saveKey(p.id)}
                disabled={busy || keyDrafts[p.id].trim() === ""}
                className="inline-flex items-center rounded-full bg-muted px-3 py-1.5 text-caption font-medium text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-50"
              >
                Save key
              </button>
              {status === "saved" && (
                <button
                  type="button"
                  onClick={() => clearKey(p.id)}
                  disabled={busy}
                  className="inline-flex items-center rounded-full bg-muted px-3 py-1.5 text-caption font-medium text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-50"
                >
                  Clear
                </button>
              )}
            </div>
            {keyErrors[p.id] && (
              <p className="mt-2 text-caption text-destructive">{keyErrors[p.id]}</p>
            )}
          </div>
        );
      })}

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-body font-semibold text-foreground">Test connection</h3>
          <button
            type="button"
            onClick={testConnection}
            disabled={testing}
            className="inline-flex items-center rounded-full bg-muted px-3 py-1.5 text-caption font-medium text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
        </div>
        {testResult?.ok && <p className="mt-2 text-caption text-muted-foreground">Connected.</p>}
        {testResult && !testResult.ok && (
          <p className="mt-2 text-caption text-destructive">{testResult.message}</p>
        )}
      </div>

      <p className="text-micro text-muted-foreground">
        Keys are stored locally in ~/.offeros on this machine and are never sent anywhere except the
        provider.
      </p>
    </div>
  );
}
