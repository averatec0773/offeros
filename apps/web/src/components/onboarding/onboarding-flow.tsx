"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, ShieldCheck, Upload } from "lucide-react";
import type { Links, Profile } from "@offeros/core";
import type { ParsedResume } from "@offeros/llm";
import { extractPdfText } from "@offeros/pdf";
import { api } from "@/lib/api-client";
import { ensurePdfWorker } from "@/lib/pdf-worker";
import { emptyProfile, normalizeProfile } from "@/components/profile/profile-client";
import { ReviewSections } from "./review-sections";

/**
 * Map the LLM's `resume-parse` output onto a core `Profile`. Two shape gaps to
 * bridge: (1) the parse task returns flat `linkedin`/`github`/`portfolio`
 * strings, but the Profile nests them under `personal.links`; (2) education and
 * experience entries arrive without ids — the Profile requires a stable id per
 * row, so we synthesise one here. Empty strings pass through untouched;
 * `normalizeProfile` prunes them at save time.
 */
export function mapParsedToProfile(parsed: ParsedResume): Profile {
  const links: Links = {};
  if (parsed.personal.linkedin) links.linkedin = parsed.personal.linkedin;
  if (parsed.personal.github) links.github = parsed.personal.github;
  if (parsed.personal.portfolio) links.portfolio = parsed.personal.portfolio;

  return {
    personal: {
      name: parsed.personal.name,
      email: parsed.personal.email,
      phone: parsed.personal.phone,
      address: parsed.personal.address,
      links,
    },
    skills: parsed.skills,
    education: parsed.education.map((e) => ({ id: crypto.randomUUID(), ...e })),
    experience: parsed.experience.map((e) => ({ id: crypto.randomUUID(), ...e })),
  };
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

type Phase = "idle" | "extracting" | "parsing" | "review" | "applying" | "error";

// Mirrors MAX_RESUME_BYTES in apps/web/src/server/services/resume-service.ts —
// keep the two in sync if the server-side limit ever changes.
const MAX_RESUME_BYTES = 10 * 1024 * 1024;

/**
 * First-run onboarding: upload a résumé → extract its text locally → parse it
 * into structured fields → review and edit → apply (persist the profile and
 * store the résumé as primary). A parse or extraction failure never dead-ends —
 * the error surfaces inline with Retry, plus a "fill in manually" escape that
 * opens the review screen empty while keeping the uploaded file for the apply
 * step. On success `onComplete` hands the saved profile back so the /profile
 * page re-renders straight into its normal editing mode.
 */
export function OnboardingFlow({
  onComplete,
}: {
  onComplete: (profile: Profile, warning?: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<Profile>(emptyProfile());
  const [resumeText, setResumeText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  async function runPipeline(f: File) {
    setError(null);
    // Clear any text extracted from a previously-selected file: if this file's
    // extraction fails, apply() must not attach the prior file's leftover text.
    setResumeText("");
    setPhase("extracting");
    try {
      ensurePdfWorker();
      const text = await extractPdfText(await f.arrayBuffer());
      setResumeText(text);
      setPhase("parsing");
      const parsed = await api.profile.parseResume({ resumeText: text });
      setDraft(mapParsedToProfile(parsed));
      setPhase("review");
    } catch {
      setError(
        "We couldn't read that résumé. Try again, or fill your details in by hand — your file is still saved.",
      );
      setPhase("error");
    }
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.type !== "application/pdf") {
      setError("Only PDF résumés are supported.");
      setPhase("error");
      return;
    }
    setFile(f);
    void runPipeline(f);
  }

  function fillManually() {
    // Keep the uploaded file (it still uploads on apply) but start from a blank
    // profile — the parse gave us nothing usable.
    setError(null);
    setDraft(emptyProfile());
    setPhase("review");
  }

  async function apply() {
    if (busyRef.current) return;
    if (file && file.size > MAX_RESUME_BYTES) {
      setError("Your résumé file is over the 10 MB limit — choose a smaller PDF before saving.");
      return;
    }
    busyRef.current = true;
    setError(null);
    setPhase("applying");
    try {
      const saved = await api.profile.save(normalizeProfile(draft));
      let warning: string | undefined;
      if (file) {
        try {
          await api.resumes.upload({
            name: file.name,
            mimeType: "application/pdf",
            dataBase64: await fileToBase64(file),
            isPrimary: true,
            text: resumeText,
          });
        } catch {
          // Profile data must never be held hostage by the file upload — complete
          // onboarding regardless. This component unmounts the moment onComplete
          // fires, so the warning is handed to the caller to surface once the
          // normal profile view is mounted, rather than shown here.
          warning =
            "Your profile was saved, but the résumé file couldn't be stored. You can re-upload it from the profile's Resumes section.";
        }
      }
      onComplete(saved, warning);
    } catch {
      setError("Couldn't save your profile. Try again.");
      setPhase("review");
    } finally {
      busyRef.current = false;
    }
  }

  if (phase === "review" || phase === "applying") {
    return (
      <main className="mx-auto w-full max-w-[860px] px-6 py-10">
        <header className="mb-6">
          <h1 className="text-heading font-semibold text-foreground">Review your details</h1>
          <p className="text-body text-muted-foreground">
            We pre-filled what we found. Edit anything that looks off, then save to finish setting
            up your profile.
          </p>
        </header>

        <ReviewSections value={draft} onChange={setDraft} />

        <div className="mt-6 flex items-center justify-end gap-3">
          {error && <span className="text-caption text-destructive">{error}</span>}
          <button
            type="button"
            onClick={apply}
            disabled={phase === "applying"}
            className="inline-flex items-center rounded-full bg-primary px-5 py-2 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
          >
            {phase === "applying" ? "Saving…" : "Save profile"}
          </button>
        </div>
      </main>
    );
  }

  const busy = phase === "extracting" || phase === "parsing";

  return (
    <main className="mx-auto w-full max-w-[860px] px-6 py-10">
      <header className="mb-6">
        <h1 className="text-heading font-semibold text-foreground">Set up your profile</h1>
        <p className="text-body text-muted-foreground">
          Upload your résumé and we&apos;ll fill in your profile for you. You can review and edit
          everything before anything is saved.
        </p>
      </header>

      <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
        {busy ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-7 animate-spin text-muted-foreground" />
            <p className="text-body-lg font-medium text-foreground">
              {phase === "extracting" ? "Reading your résumé…" : "Pulling out your details…"}
            </p>
            {file && (
              <p className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
                <FileText className="size-4" />
                {file.name}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-full bg-secondary">
              <Upload className="size-5.5 text-secondary-foreground" />
            </div>
            <div>
              <p className="text-title font-semibold text-foreground">Upload your résumé</p>
              <p className="mx-auto mt-1 max-w-[420px] text-body text-muted-foreground">
                PDF only. We&apos;ll read it and pre-fill your personal details, education,
                experience, and skills.
              </p>
            </div>

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
            >
              Choose PDF
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              onChange={onFileSelected}
              className="hidden"
            />

            {error && phase === "error" ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-caption text-destructive">{error}</p>
                <div className="flex items-center gap-2">
                  {file && (
                    <button
                      type="button"
                      onClick={() => runPipeline(file)}
                      className="rounded-full border border-border px-3 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
                    >
                      Retry
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={fillManually}
                    className="rounded-full border border-border px-3 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
                  >
                    Fill in manually
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={fillManually}
                className="text-caption font-medium text-muted-foreground underline-offset-2 hover:underline"
              >
                or fill in manually
              </button>
            )}
          </div>
        )}
      </div>

      <p className="mt-4 inline-flex items-center gap-1.5 text-caption text-muted-foreground">
        <ShieldCheck className="size-4" />
        Your résumé file stays on this machine — only the extracted text is sent to your configured
        AI provider to fill in your details.
      </p>
    </main>
  );
}
