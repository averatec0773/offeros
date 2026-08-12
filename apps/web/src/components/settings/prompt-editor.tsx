"use client";

import { useEffect, useState } from "react";
import { getTask, modelsFor, type TaskId } from "@offeros/llm";
import { api, type ClientSettings } from "@/lib/api-client";

const TASKS: { id: TaskId; label: string }[] = [
  { id: "resume-tailor", label: "Résumé tailoring" },
  { id: "jd-analysis", label: "Job description analysis" },
  { id: "cover-letter", label: "Cover letter" },
  { id: "question-answer", label: "Question answer" },
  { id: "resume-parse", label: "Résumé parsing" },
  { id: "fit-analysis", label: "Fit analysis" },
  { id: "style-distill", label: "Style memory distillation" },
  { id: "field-analyze", label: "Filling leftover fields from your material" },
];

// Strips empty-string entries so an emptied field clears the override instead
// of persisting "" (which would beat the task default forever).
function cleanOverrides(drafts: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [id, value] of Object.entries(drafts)) {
    if (value.trim() !== "") next[id] = value;
  }
  return next;
}

export function PromptEditor() {
  const [settings, setSettings] = useState<ClientSettings | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.settings
      .get()
      .then((s) => {
        setSettings(s);
        setPromptDrafts({ ...s.llm.promptOverrides });
        setModelDrafts({ ...s.llm.modelOverrides });
      })
      .catch(() => setError("Couldn't load settings."));
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next: ClientSettings = {
        ...settings,
        llm: {
          ...settings.llm,
          promptOverrides: cleanOverrides(promptDrafts),
          modelOverrides: cleanOverrides(modelDrafts),
        },
      };
      const result = await api.settings.save(next);
      setSettings(result);
      setPromptDrafts({ ...result.llm.promptOverrides });
      setModelDrafts({ ...result.llm.modelOverrides });
      setSaved(true);
    } catch {
      setError("Couldn't save settings. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return <p className="text-body text-muted-foreground">Loading…</p>;
  }

  const models = modelsFor(settings.llm.provider);

  return (
    <div className="flex flex-col gap-4">
      {TASKS.map(({ id, label }) => {
        const defaultPrompt = getTask(id)?.defaultSystemPrompt ?? "";
        return (
          <div key={id} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-title font-semibold text-foreground">{label}</h2>
              <select
                value={modelDrafts[id] ?? ""}
                onChange={(e) => setModelDrafts((d) => ({ ...d, [id]: e.target.value }))}
                className="rounded-lg border border-border bg-background px-2 py-1 text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Use global model</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <textarea
              rows={6}
              value={promptDrafts[id] ?? ""}
              onChange={(e) => setPromptDrafts((d) => ({ ...d, [id]: e.target.value }))}
              placeholder={defaultPrompt}
              className="mt-3 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 font-mono text-caption text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <p className="mt-1 text-micro text-muted-foreground">
              Leave blank to use the built-in default shown above (as placeholder).
            </p>
          </div>
        );
      })}

      {error && <p className="text-caption text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-caption text-muted-foreground">Saved.</span>}
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center rounded-full bg-primary px-4 py-2 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
