"use client";

import type { Profile } from "@offeros/core";
import { PersonalForm } from "@/components/profile/personal-form";
import { EducationList } from "@/components/profile/education-list";
import { ExperienceList } from "@/components/profile/experience-list";
import { SkillsEditor } from "@/components/profile/skills-editor";

/**
 * The onboarding review screen: the four core-profile sections pre-filled from
 * the parsed résumé, every field editable. Reuses Task 4's pure controlled
 * editors verbatim — no form logic is forked here, only the card chrome and the
 * single `Profile` value threaded through them.
 */
export function ReviewSections({
  value,
  onChange,
}: {
  value: Profile;
  onChange: (value: Profile) => void;
}) {
  function set<K extends keyof Profile>(key: K, next: Profile[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <div className="space-y-6">
      <ReviewCard title="Personal">
        <PersonalForm value={value.personal} onChange={(v) => set("personal", v)} />
      </ReviewCard>

      <ReviewCard title="Education">
        <EducationList value={value.education} onChange={(v) => set("education", v)} />
      </ReviewCard>

      <ReviewCard title="Work experience">
        <ExperienceList value={value.experience} onChange={(v) => set("experience", v)} />
      </ReviewCard>

      <ReviewCard title="Skills">
        <SkillsEditor value={value.skills} onChange={(v) => set("skills", v)} />
      </ReviewCard>
    </div>
  );
}

function ReviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="text-title font-semibold text-foreground">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
