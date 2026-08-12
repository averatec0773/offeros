"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Education, Experience, Profile } from "@offeros/core";
import { api } from "@/lib/api-client";
import { SectionNav, type SectionNavItem, type SaveStatus } from "./section-nav";
import { PersonalForm } from "./personal-form";
import { EducationList } from "./education-list";
import { ExperienceList } from "./experience-list";
import { SkillsEditor } from "./skills-editor";
import { AnswersEditor } from "./answers-editor";
import { EeoEditor } from "./eeo-editor";
import { ResumesSection } from "@/components/documents/resumes-section";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

const SECTIONS: SectionNavItem[] = [
  { id: "personal", label: "Personal" },
  { id: "education", label: "Education" },
  { id: "experience", label: "Work experience" },
  { id: "skills", label: "Skills" },
  { id: "answers", label: "Answers" },
  { id: "eeo", label: "Equal Employment" },
  { id: "resumes", label: "Résumés" },
];

/** A blank, schema-valid profile document. */
export function emptyProfile(): Profile {
  return {
    personal: { name: "", email: "", phone: "", links: {} },
    skills: [],
    education: [],
    experience: [],
  };
}

const OPTIONAL_PERSONAL = ["address", "city", "state", "country", "postalCode"] as const;

/** True when every field but `id` is blank — an Add-then-Save-with-no-input row. */
function isBlankEducation(edu: Education): boolean {
  return (
    !edu.school.trim() &&
    !edu.degree.trim() &&
    !edu.field.trim() &&
    !edu.start.trim() &&
    !edu.end.trim() &&
    !edu.gpa?.trim()
  );
}

/** True when every field but `id` is blank — an Add-then-Save-with-no-input row. */
function isBlankExperience(exp: Experience): boolean {
  return (
    !exp.company.trim() &&
    !exp.title.trim() &&
    !exp.start.trim() &&
    !exp.end.trim() &&
    exp.bullets.every((b) => !b.trim())
  );
}

/**
 * Drops empty optional fields so a blank input never persists an "" into a slot
 * the schema treats as absent (keeps the stored document clean; required
 * name/email/phone are left as-is). Also trims away empty skills and bullets,
 * omits an empty `gpa`, and drops education/experience rows left entirely
 * blank (e.g. Add then Save with no input).
 */
export function normalizeProfile(profile: Profile): Profile {
  const links: Record<string, string> = {};
  for (const [key, val] of Object.entries(profile.personal.links ?? {})) {
    if (val && val.trim() !== "") links[key] = val.trim();
  }

  const personal: Profile["personal"] = {
    name: profile.personal.name,
    email: profile.personal.email,
    phone: profile.personal.phone,
    links,
  };
  for (const key of OPTIONAL_PERSONAL) {
    const val = profile.personal[key];
    if (val && val.trim() !== "") personal[key] = val.trim();
  }

  const education = profile.education
    .map((edu) => {
      const trimmedGpa = edu.gpa?.trim();
      const next = { ...edu };
      if (trimmedGpa) next.gpa = trimmedGpa;
      else delete next.gpa;
      return next;
    })
    .filter((edu) => !isBlankEducation(edu));

  const experience = profile.experience
    .map((exp) => ({ ...exp, bullets: exp.bullets.map((b) => b.trim()).filter(Boolean) }))
    .filter((exp) => !isBlankExperience(exp));

  return {
    personal,
    skills: profile.skills.map((s) => s.trim()).filter(Boolean),
    education,
    experience,
  };
}

const AUTOSAVE_DELAY_MS = 600;

export function ProfileClient({ initialProfile }: { initialProfile: Profile | null }) {
  const [draft, setDraft] = useState<Profile | null>(initialProfile);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [resumeWarning, setResumeWarning] = useState<string | null>(null);

  // Autosave plumbing. `draftRef` always mirrors the freshest draft so a
  // debounced or coalesced save reads the latest value (latest-wins). `inFlight`
  // guards against concurrent PUTs; `pending` records that the draft changed
  // again while a save was running, so exactly one follow-up save fires with the
  // newest draft once the in-flight one resolves — no thundering PUTs, no lost
  // edits.
  const draftRef = useRef(draft);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function saveNow() {
    const snapshot = draftRef.current;
    if (!snapshot) return;
    if (inFlightRef.current) {
      // A save is already running — remember that we owe another pass with the
      // latest draft, then let the in-flight save trigger it on resolve.
      pendingRef.current = true;
      return;
    }
    inFlightRef.current = true;
    pendingRef.current = false;
    setSaveStatus("saving");
    try {
      await api.profile.save(normalizeProfile(snapshot));
      inFlightRef.current = false;
      if (pendingRef.current) {
        // The draft moved on while we were saving → save once more with the
        // freshest value; that call owns the final status.
        pendingRef.current = false;
        await saveNow();
        return;
      }
      setSaveStatus("saved");
    } catch {
      // Keep the user's draft intact; only surface the failure.
      inFlightRef.current = false;
      setSaveStatus("error");
    }
  }

  function scheduleSave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void saveNow();
    }, AUTOSAVE_DELAY_MS);
  }

  function patch<K extends keyof Profile>(key: K, value: Profile[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    // Clear a stale "saved"/"error" badge on the next keystroke, but never
    // interrupt an in-flight "saving" — that save is coalescing with this edit.
    setSaveStatus((s) => (s === "saving" ? s : "idle"));
    scheduleSave();
  }

  const privacy = (
    <p className="text-caption text-muted-foreground">
      Your data stays on this machine — nothing is uploaded.
    </p>
  );

  if (!draft) {
    // No profile yet → first-run onboarding. On completion it hands back the
    // saved profile, which drops us straight into normal editing mode below —
    // along with an optional warning (e.g. the résumé file failed to upload)
    // that this component unmounts before, so we carry it forward here.
    return (
      <OnboardingFlow
        onComplete={(profile, warning) => {
          setDraft(profile);
          if (warning) setResumeWarning(warning);
        }}
      />
    );
  }

  // Completeness tracks the core Profile document only — Answers/EEO/Resumes
  // are independent entities with their own persistence, not Profile fields.
  const completenessChecks = [
    Boolean(draft.personal.name && draft.personal.email),
    draft.education.length > 0,
    draft.experience.length > 0,
    draft.skills.length > 0,
  ];
  const completeness = completenessChecks.filter(Boolean).length;

  return (
    <main className="mx-auto w-full max-w-[1120px] px-6 py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-heading font-semibold text-foreground">Profile</h1>
          {privacy}
        </div>
        <span className="text-caption text-muted-foreground">
          {completeness} of {completenessChecks.length} sections complete
        </span>
      </header>

      {resumeWarning && (
        <div className="mb-6 flex items-start justify-between gap-3 rounded-xl bg-warn-bg p-4">
          <p className="text-body text-foreground">{resumeWarning}</p>
          <button
            type="button"
            onClick={() => setResumeWarning(null)}
            aria-label="Dismiss"
            className="inline-flex size-5.5 shrink-0 items-center justify-center rounded-full text-foreground/60 transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      <div className="sticky top-14 z-10 -mx-6 mb-6 bg-background/90 px-6 py-2 backdrop-blur">
        <SectionNav items={SECTIONS} saveStatus={saveStatus} onRetry={() => void saveNow()} />
      </div>

      <div className="space-y-6">
        {/* The four profile-document sections autosave on change — no Save
            footer. Answers/EEO/Résumés persist themselves per-action. */}
        <SectionCard id="personal" title="Personal">
          <PersonalForm value={draft.personal} onChange={(v) => patch("personal", v)} />
        </SectionCard>

        <SectionCard id="education" title="Education">
          <EducationList value={draft.education} onChange={(v) => patch("education", v)} />
        </SectionCard>

        <SectionCard id="experience" title="Work experience">
          <ExperienceList value={draft.experience} onChange={(v) => patch("experience", v)} />
        </SectionCard>

        <SectionCard id="skills" title="Skills">
          <SkillsEditor value={draft.skills} onChange={(v) => patch("skills", v)} />
        </SectionCard>

        <SectionCard id="answers" title="Answers">
          <AnswersEditor />
        </SectionCard>

        <SectionCard
          id="eeo"
          title="Equal Employment"
          description="Standard EEO/compliance questions collected on most job applications."
        >
          <EeoEditor />
        </SectionCard>

        <SectionCard id="resumes" title="Résumés">
          <ResumesSection />
        </SectionCard>
      </div>
    </main>
  );
}

/**
 * Card chrome for a profile section. The profile-document sections (Personal,
 * Education, Experience, Skills) autosave on change; the entity sections
 * (Answers, Equal Employment, Résumés) persist themselves per-action against
 * their own API — either way there is no per-section Save footer.
 */
function SectionCard({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-border bg-card p-4">
      <h2 className="text-title font-semibold text-foreground">{title}</h2>
      {description && <p className="mt-1 text-caption text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
