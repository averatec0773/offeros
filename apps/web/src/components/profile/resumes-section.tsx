"use client";

import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { ResumeSummary } from "@offeros/core";
import { extractPdfText } from "@offeros/pdf";
import { api } from "@/lib/api-client";
import { ensurePdfWorker } from "@/lib/pdf-worker";
import { inputClass } from "./fields";

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Résumé management: upload (PDF only, sent as base64), set-primary, delete.
 * Self-contained: fetches and persists directly against `api.resumes`,
 * independent of the Profile document.
 */
export function ResumesSection() {
  const [resumes, setResumes] = useState<ResumeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNote, setEditNote] = useState("");

  useEffect(() => {
    api.resumes
      .list()
      .then(setResumes)
      .catch(() => setError("Couldn't load résumés."));
  }, []);

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError("Only PDF résumés are supported.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      let text = "";
      try {
        ensurePdfWorker();
        text = await extractPdfText(await file.arrayBuffer());
      } catch {
        // Extraction is a nice-to-have for tailoring — never block the upload
        // over it. The file still uploads with empty text.
      }
      const dataBase64 = await fileToBase64(file);
      const created = await api.resumes.upload({
        name: file.name,
        mimeType: "application/pdf",
        dataBase64,
        isPrimary: (resumes ?? []).length === 0,
        text,
      });
      setResumes((r) => [...(r ?? []), created]);
    } catch {
      setError("Couldn't upload that résumé.");
    } finally {
      setUploading(false);
    }
  }

  async function setPrimary(id: string) {
    setError(null);
    try {
      const updated = await api.resumes.setPrimary(id);
      setResumes((r) => (r ?? []).map((x) => (x.id === id ? updated : { ...x, isPrimary: false })));
    } catch {
      setError("Couldn't set that résumé as primary.");
    }
  }

  function startEdit(resume: ResumeSummary) {
    setError(null);
    setConfirmId(null);
    setEditId(resume.id);
    setEditName(resume.name);
    setEditNote(resume.note ?? "");
  }

  async function saveEdit(id: string) {
    setError(null);
    try {
      const updated = await api.resumes.update(id, {
        name: editName.trim(),
        note: editNote.trim(),
      });
      setResumes((r) => (r ?? []).map((x) => (x.id === id ? updated : x)));
      setEditId(null);
    } catch {
      setError("Couldn't save that résumé.");
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api.resumes.remove(id);
      setConfirmId(null);
      // Refetch the list to ensure any server-side auto-promoted primary shows correctly.
      const updated = await api.resumes.list();
      setResumes(updated);
    } catch {
      setError("Couldn't delete that résumé.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-caption text-destructive">{error}</p>}

      {resumes !== null && resumes.length === 0 && (
        <p className="text-body text-muted-foreground">No résumés uploaded yet.</p>
      )}

      {(resumes ?? []).map((resume) =>
        editId === resume.id ? (
          <div
            key={resume.id}
            className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3"
          >
            <label className="flex flex-col gap-1">
              <span className="text-caption font-medium text-muted-foreground">Résumé name</span>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption font-medium text-muted-foreground">Note</span>
              <input
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="e.g. tailored for backend / platform roles"
                className={inputClass}
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => saveEdit(resume.id)}
                className="rounded-full bg-primary px-3 py-1.5 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditId(null)}
                className="rounded-full border border-border px-3 py-1.5 text-caption font-medium text-foreground transition-colors hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            key={resume.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background p-3"
          >
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2 text-body font-medium text-foreground">
                {resume.name}
                {resume.isPrimary && (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-micro font-semibold text-secondary-foreground">
                    Primary
                  </span>
                )}
              </span>
              {resume.note && <span className="text-caption text-foreground">{resume.note}</span>}
              <span className="text-caption text-muted-foreground">
                Added {new Date(resume.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {confirmId === resume.id ? (
                <>
                  <span className="text-caption text-muted-foreground">Delete?</span>
                  <button
                    type="button"
                    onClick={() => remove(resume.id)}
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
                  {!resume.isPrimary && (
                    <button
                      type="button"
                      onClick={() => setPrimary(resume.id)}
                      aria-label={`Set ${resume.name} as primary`}
                      className="rounded-full border border-border px-3 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
                    >
                      Set primary
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => startEdit(resume)}
                    aria-label={`Edit ${resume.name}`}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="size-4" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(resume.id)}
                    aria-label={`Delete ${resume.name}`}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ),
      )}

      <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted">
        {uploading ? "Uploading…" : "Upload résumé (PDF)"}
        <input
          type="file"
          accept="application/pdf"
          disabled={uploading}
          onChange={onFileSelected}
          className="hidden"
        />
      </label>
    </div>
  );
}
