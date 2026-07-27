import { isBlankEducation, isBlankExperience, type ArtifactVersion } from "@offeros/core";

/** The serialized `content`'s header block: the lines before the first blank
 *  line. `resumeData` deliberately carries no header (name/contact info come
 *  from the profile, never the LLM), so the header is read off `content`.
 *  Deliberate asymmetry: this viewer shows the header frozen at generation
 *  time (baked into `content`), while PDF export rebuilds the header from the
 *  CURRENT profile via `buildResumeHeader` (`export-service.ts`) — both are
 *  intended, so a later profile edit updates future PDFs without silently
 *  rewriting an already-approved artifact's on-screen header. */
function headerLines(content: string): string[] {
  const blankAt = content.indexOf("\n\n");
  const block = blankAt === -1 ? content : content.slice(0, blankAt);
  return block.split("\n");
}

/** Structured résumé view for a `resume` artifact version that has
 *  `resumeData`: header + Summary/Experience/Education/Skills sections,
 *  rather than the raw serialized text. Bullets present in `changedLines`
 *  get the same highlight treatment as the text render. */
export function ResumeView({ version }: { version: ArtifactVersion }) {
  const resumeData = version.resumeData!;
  const changedLines = new Set(version.changedLines ?? []);
  const experience = resumeData.experience.filter((exp) => !isBlankExperience(exp));
  const education = resumeData.education.filter((edu) => !isBlankEducation(edu));

  return (
    <div className="mt-3 space-y-4 rounded-xl bg-muted p-4">
      <div>
        {headerLines(version.content).map((line, i) => (
          <p
            key={i}
            className={
              i === 0
                ? "text-body font-semibold text-foreground"
                : "text-caption text-muted-foreground"
            }
          >
            {line}
          </p>
        ))}
      </div>

      {resumeData.summary.trim() && (
        <section>
          <h4 className="text-caption font-semibold text-muted-foreground">Summary</h4>
          <p className="mt-1 text-body text-foreground">{resumeData.summary}</p>
        </section>
      )}

      {experience.length > 0 && (
        <section>
          <h4 className="text-caption font-semibold text-muted-foreground">Experience</h4>
          <div className="mt-1.5 space-y-3">
            {experience.map((exp, i) => (
              <div key={i}>
                <p className="text-body font-semibold text-foreground">
                  {exp.title} — {exp.company} ({exp.dates})
                </p>
                <ul className="mt-1 space-y-0.5">
                  {exp.bullets.map((bullet, j) => (
                    <li
                      key={j}
                      className={`rounded px-1 text-caption text-foreground ${
                        changedLines.has(bullet) ? "bg-brand/15" : ""
                      }`}
                    >
                      • {bullet}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {education.length > 0 && (
        <section>
          <h4 className="text-caption font-semibold text-muted-foreground">Education</h4>
          <div className="mt-1.5 space-y-2">
            {education.map((edu, i) => (
              <div key={i} className="text-caption text-foreground">
                <p>
                  {edu.degree}, {edu.field} — {edu.school} ({edu.dates})
                </p>
                {edu.details.trim() && (
                  <p className="mt-0.5 text-muted-foreground">{edu.details}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {resumeData.skills.length > 0 && (
        <section>
          <h4 className="text-caption font-semibold text-muted-foreground">Skills</h4>
          <p className="mt-1 text-caption text-foreground">{resumeData.skills.join(", ")}</p>
        </section>
      )}
    </div>
  );
}
