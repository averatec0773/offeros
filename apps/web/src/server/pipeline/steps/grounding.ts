import type { Application, Profile, ResumeSummary } from "@offeros/core";

/**
 * Plain-text facts about the applicant derived from their profile: contact
 * info, experience bullets, skills, education. Used both as the "résumé"
 * input to the resume-tailor task (the pipeline does not yet consume a
 * stored raw résumé text) and as the profile summary fed to jd-analysis.
 */
export function buildProfileFacts(profile: Profile): string {
  const lines: string[] = [];

  lines.push(`Name: ${profile.personal.name}`);
  if (profile.personal.email) lines.push(`Email: ${profile.personal.email}`);
  if (profile.personal.phone) lines.push(`Phone: ${profile.personal.phone}`);
  const location = [profile.personal.city, profile.personal.state, profile.personal.country]
    .filter(Boolean)
    .join(", ");
  if (location) lines.push(`Location: ${location}`);
  if (profile.personal.links.linkedin) lines.push(`LinkedIn: ${profile.personal.links.linkedin}`);
  if (profile.personal.links.github) lines.push(`GitHub: ${profile.personal.links.github}`);
  if (profile.personal.links.portfolio)
    lines.push(`Portfolio: ${profile.personal.links.portfolio}`);

  if (profile.experience.length > 0) {
    lines.push("", "Experience:");
    for (const exp of profile.experience) {
      lines.push(`- ${exp.title} at ${exp.company} (${exp.start} – ${exp.end})`);
      for (const bullet of exp.bullets) lines.push(`  • ${bullet}`);
    }
  }

  if (profile.skills.length > 0) {
    lines.push("", `Skills: ${profile.skills.join(", ")}`);
  }

  if (profile.education.length > 0) {
    lines.push("", "Education:");
    for (const edu of profile.education) {
      lines.push(`- ${edu.degree} in ${edu.field}, ${edu.school} (${edu.start} – ${edu.end})`);
    }
  }

  return lines.join("\n");
}

/**
 * The grounding block the cover-letter generator may cite facts from: the
 * applicant's profile facts plus the (tailored) résumé text. This is the ONLY
 * fact source the cover-letter task is allowed to draw on.
 */
export function buildGroundingFacts(profile: Profile, resumeText: string): string {
  const facts = buildProfileFacts(profile);
  const resume = resumeText.trim();
  return resume ? `${facts}\n\nRésumé text:\n${resume}` : facts;
}

/**
 * Resolves which stored résumé applies to an application: the explicit
 * selection (`application.resumeId`) if it still exists, else the account's
 * primary résumé. Single source of the default-to-primary rule so the
 * workspace picker, the tailor grounding, and the fill bundle's "which file
 * to attach" all agree. A selection pointing at a since-deleted résumé
 * self-heals to primary rather than resolving to nothing.
 */
export function resolveEffectiveResume(
  application: Pick<Application, "resumeId">,
  resumes: ResumeSummary[],
): ResumeSummary | undefined {
  return resumes.find((r) => r.id === application.resumeId) ?? resumes.find((r) => r.isPrimary);
}

/**
 * Resolves which résumé's stored text should ground the tailor task, via
 * `resolveEffectiveResume`. Falls back to `buildProfileFacts` when there's no
 * selected/primary résumé, or its stored text is empty/whitespace-only.
 */
export function resolveResumeText(
  application: Pick<Application, "resumeId">,
  resumes: ResumeSummary[],
  profile: Profile,
): string {
  const text = resolveEffectiveResume(application, resumes)?.text;
  return text && text.trim() ? text : buildProfileFacts(profile);
}
