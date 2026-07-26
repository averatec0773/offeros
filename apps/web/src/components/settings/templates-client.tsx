"use client";

import { useEffect, useState } from "react";
import { Eye, FileUp, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { BODY_START, BODY_END, type Template } from "@offeros/core";
import { BUILTIN_STARTER } from "@/server/export/builtin-starter";
import { api } from "@/lib/api-client";
import { LabeledInput } from "@/components/profile/fields";
import { TemplatePreview, type PreviewSource } from "./template-preview";

type Draft = { name: string; scaffoldHints: string; content: string };

/** The confirm-panel state, shared by upload / built-in / edit entry points. */
type Editor = {
  mode: "new" | "edit";
  id: string | null;
  kind: string;
  renderer: string;
  isDefault: boolean;
  draft: Draft;
  /** From `analyze` only — `null` means the panel wasn't opened from an upload. */
  detected: boolean | null;
  warnings: string[];
  saving: boolean;
  error: string | null;
};

function toDraft(t: Template): Draft {
  return { name: t.name, scaffoldHints: t.scaffoldHints, content: t.content };
}

/** Strip a trailing file extension (`my-letter.tex` → `my-letter`). */
function stripExtension(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, "");
}

/** Insert/replace a template in the list, clearing other defaults when it is the default. */
function upsert(list: Template[], rec: Template): Template[] {
  const merged = list.some((x) => x.id === rec.id)
    ? list.map((x) => (x.id === rec.id ? rec : x))
    : [...list, rec];
  return rec.isDefault
    ? merged.map((x) => (x.id === rec.id ? x : { ...x, isDefault: false }))
    : merged;
}

/**
 * Cover-letter template management. Two entry actions create a template —
 * uploading a `.tex` file (analyzed server-side to place the body markers) or
 * starting from the built-in HTML scaffold — both landing in the same confirm
 * panel that editing an existing template uses. The panel and each saved row
 * can render an inline PDF preview. Self-contained against `api.templates`.
 */
export function TemplatesClient() {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ source: PreviewSource; title: string } | null>(null);

  useEffect(() => {
    api.templates
      .list()
      .then(setTemplates)
      .catch(() => setError("Couldn't load templates."));
  }, []);

  async function setDefault(t: Template) {
    setError(null);
    try {
      const updated = await api.templates.update(t.id, {
        name: t.name,
        kind: t.kind,
        renderer: t.renderer,
        content: t.content,
        scaffoldHints: t.scaffoldHints,
        isDefault: true,
      });
      setTemplates((ts) => upsert(ts ?? [], updated));
    } catch {
      setError("Couldn't set that template as default.");
    }
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadError(null);
    setUploadBusy(true);
    try {
      const content = await file.text();
      const analysis = await api.templates.analyze({ content, filename: file.name });
      setEditor({
        mode: "new",
        id: null,
        kind: "cover-letter",
        renderer: "latex",
        isDefault: false,
        draft: {
          name: stripExtension(file.name),
          scaffoldHints: analysis.scaffoldHints,
          content: analysis.contentWithMarkers,
        },
        detected: analysis.detected,
        warnings: analysis.warnings,
        saving: false,
        error: null,
      });
    } catch {
      setUploadError("Couldn't read that file.");
    } finally {
      setUploadBusy(false);
    }
  }

  function startBuiltin() {
    setUploadError(null);
    setEditor({
      mode: "new",
      id: null,
      kind: "cover-letter",
      renderer: "builtin",
      isDefault: false,
      draft: { name: "Built-in cover letter", scaffoldHints: "", content: BUILTIN_STARTER },
      detected: null,
      warnings: [],
      saving: false,
      error: null,
    });
  }

  function startEdit(t: Template) {
    setEditor({
      mode: "edit",
      id: t.id,
      kind: t.kind,
      renderer: t.renderer,
      isDefault: t.isDefault,
      draft: toDraft(t),
      detected: null,
      warnings: [],
      saving: false,
      error: null,
    });
  }

  function patchDraft(patch: Partial<Draft>) {
    setEditor((ed) => (ed ? { ...ed, draft: { ...ed.draft, ...patch } } : ed));
  }

  async function save() {
    const ed = editor;
    if (!ed) return;
    if (!ed.draft.name.trim()) {
      setEditor({ ...ed, error: "Give the template a name." });
      return;
    }
    setEditor({ ...ed, saving: true, error: null });
    const payload = {
      name: ed.draft.name,
      kind: ed.kind,
      renderer: ed.renderer,
      content: ed.draft.content,
      scaffoldHints: ed.draft.scaffoldHints,
      isDefault: ed.isDefault,
    };
    try {
      const saved =
        ed.mode === "edit" && ed.id
          ? await api.templates.update(ed.id, payload)
          : await api.templates.save(payload);
      setTemplates((ts) => upsert(ts ?? [], saved));
      setEditor(null);
    } catch {
      setEditor((prev) =>
        prev ? { ...prev, saving: false, error: "Couldn't save that template." } : prev,
      );
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api.templates.remove(id);
      setTemplates((ts) => (ts ?? []).filter((x) => x.id !== id));
      setConfirmId(null);
    } catch {
      setError("Couldn't delete that template.");
    }
  }

  function previewDraft() {
    if (!editor) return;
    setPreview({
      source: {
        content: editor.draft.content,
        renderer: editor.renderer,
        scaffoldHints: editor.draft.scaffoldHints,
      },
      title: editor.draft.name || "Cover letter",
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-caption text-destructive">{error}</p>}

      {editor && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-body font-semibold text-foreground">
              {editor.mode === "edit" ? "Edit template" : "New template"}
            </h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-micro font-semibold text-secondary-foreground">
              {editor.renderer}
            </span>
          </div>

          {editor.detected === false && (
            <div className="mt-3 rounded-xl bg-warn-bg p-3 text-caption text-foreground">
              We couldn&apos;t detect the editable body region in this file. Place the {BODY_START}{" "}
              and {BODY_END} markers around the paragraph(s) OfferOS should rewrite before saving.
            </div>
          )}

          {editor.warnings.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-caption text-muted-foreground">
              {editor.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          <LabeledInput
            label="Name"
            value={editor.draft.name}
            onChange={(v) => patchDraft({ name: v })}
            className="mt-3"
          />
          <LabeledInput
            label="Scaffold hints"
            value={editor.draft.scaffoldHints}
            onChange={(v) => patchDraft({ scaffoldHints: v })}
            placeholder='Salutation: "Dear Hiring Team,". Closing: "Sincerely,". Body: 4 paragraphs.'
            className="mt-3"
          />
          <label className="mt-3 flex flex-col gap-1">
            <span className="text-caption font-medium text-muted-foreground">Content</span>
            <textarea
              rows={12}
              value={editor.draft.content}
              onChange={(e) => patchDraft({ content: e.target.value })}
              className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 font-mono text-caption text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </label>
          <p className="mt-1 text-micro text-muted-foreground">
            Mark the AI-editable section with {BODY_START} and {BODY_END} — everything outside those
            markers is left untouched.
          </p>

          {editor.error && <p className="mt-2 text-caption text-destructive">{editor.error}</p>}

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditor(null)}
              className="rounded-full border border-border px-3 py-1.5 text-caption font-medium text-foreground transition-colors hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={previewDraft}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
            >
              <Eye className="size-4" />
              Preview
            </button>
            <button
              type="button"
              onClick={save}
              disabled={editor.saving}
              className="rounded-full bg-primary px-3 py-1.5 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
            >
              {editor.saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {templates !== null && templates.length === 0 && !editor && (
        <p className="text-body text-muted-foreground">No templates yet.</p>
      )}

      {(templates ?? [])
        .filter((t) => !(editor?.mode === "edit" && editor.id === t.id))
        .map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-2 text-body font-medium text-foreground">
                {t.name}
                <span className="rounded-full bg-secondary px-2 py-0.5 text-micro font-semibold text-secondary-foreground">
                  {t.renderer}
                </span>
              </span>
              <span className="truncate text-caption text-muted-foreground">{t.scaffoldHints}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {confirmId === t.id ? (
                <>
                  <span className="text-caption text-muted-foreground">Delete?</span>
                  <button
                    type="button"
                    onClick={() => remove(t.id)}
                    className="rounded-full bg-destructive/10 px-3 py-1.5 text-caption font-semibold text-destructive transition-colors hover:bg-destructive/20"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className="rounded-full border border-border px-3 py-1.5 text-caption font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {t.isDefault ? (
                    <span aria-label="Default template" title="Default template">
                      <Star className="size-4.5 fill-brand text-brand" />
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDefault(t)}
                      aria-label={`Set ${t.name} as default`}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
                    >
                      <Star className="size-4" />
                      Set default
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPreview({ source: { id: t.id }, title: t.name })}
                    aria-label={`Preview ${t.name}`}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Eye className="size-4" />
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(t)}
                    aria-label={`Edit ${t.name}`}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="size-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(t.id)}
                    aria-label={`Delete ${t.name}`}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ))}

      {!editor && (
        <div className="rounded-2xl border border-dashed border-border p-4">
          <p className="text-caption font-medium text-foreground">Add a cover-letter template</p>
          <p className="mt-1 text-caption text-muted-foreground">
            Upload your own LaTeX letter, or start from the built-in scaffold.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted">
              <FileUp className="size-4" />
              {uploadBusy ? "Analyzing…" : "Upload .tex file"}
              <input
                type="file"
                accept=".tex,text/plain,text/x-tex"
                disabled={uploadBusy}
                onChange={onFileSelected}
                className="hidden"
              />
            </label>
            <button
              type="button"
              onClick={startBuiltin}
              className="inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
            >
              <Plus className="size-4" />
              New built-in template
            </button>
          </div>
          {uploadError && <p className="mt-2 text-caption text-destructive">{uploadError}</p>}
        </div>
      )}

      {preview && (
        <TemplatePreview
          source={preview.source}
          title={preview.title}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
