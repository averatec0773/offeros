import { z } from "zod";

const structuredResumeShape = z.object({
  summary: z.string().catch(""),
  experience: z
    .array(
      z.object({
        company: z.string().catch(""),
        title: z.string().catch(""),
        dates: z.string().catch(""),
        bullets: z.array(z.string()).catch([]),
      }),
    )
    .catch([]),
  education: z
    .array(
      z.object({
        school: z.string().catch(""),
        degree: z.string().catch(""),
        field: z.string().catch(""),
        dates: z.string().catch(""),
        details: z.string().catch(""),
      }),
    )
    .catch([]),
  skills: z.array(z.string()).catch([]),
});

// Top-level .catch(): a weak model can hand back something that isn't even an
// object (a string, null, an array). Every field above already tolerates bad
// *values*, but z.object() still throws if the input itself isn't a plain
// object. Wrapping the whole shape keeps that case tolerant too, so the
// artifact version always parses to a fully-defaulted StructuredResume
// instead of throwing away the version.
export const structuredResumeSchema = structuredResumeShape.catch({
  summary: "",
  experience: [],
  education: [],
  skills: [],
});

export type StructuredResume = z.infer<typeof structuredResumeSchema>;

// Header/contact for the serialized/rendered résumé (from the profile's personal).
export type ResumeHeader = {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  links?: string[];
};

/**
 * Deterministic plain-text form of a structured résumé: header block, then
 * SUMMARY / EXPERIENCE / EDUCATION / SKILLS sections. Empty sections are
 * skipped. Same input always produces the same string — this feeds the
 * viewer fallback, the tweak line-diff, and the text download.
 */
export function serializeResume(r: StructuredResume, header: ResumeHeader): string {
  const headerLines = [header.name];
  if (header.email) headerLines.push(header.email);
  if (header.phone) headerLines.push(header.phone);
  if (header.location) headerLines.push(header.location);
  for (const link of header.links ?? []) {
    if (link) headerLines.push(link);
  }

  const sections: string[] = [];

  if (r.summary.trim()) {
    sections.push(["SUMMARY", r.summary].join("\n"));
  }

  if (r.experience.length) {
    const entries = r.experience.map((exp) => {
      const entryLines = [`${exp.title} — ${exp.company} (${exp.dates})`];
      for (const bullet of exp.bullets) entryLines.push(`- ${bullet}`);
      return entryLines.join("\n");
    });
    sections.push(["EXPERIENCE", entries.join("\n\n")].join("\n"));
  }

  if (r.education.length) {
    const entries = r.education.map((edu) => {
      const entryLines = [`${edu.degree}, ${edu.field} — ${edu.school} (${edu.dates})`];
      if (edu.details.trim()) entryLines.push(edu.details);
      return entryLines.join("\n");
    });
    sections.push(["EDUCATION", entries.join("\n\n")].join("\n"));
  }

  if (r.skills.length) {
    sections.push(["SKILLS", r.skills.join(", ")].join("\n"));
  }

  const headerBlock = headerLines.join("\n");
  const body = sections.join("\n\n");
  return body ? `${headerBlock}\n\n${body}` : headerBlock;
}
