import {
  isBlankEducation,
  isBlankExperience,
  type ResumeHeader,
  type StructuredResume,
} from "@offeros/core";
import { escapeHtml, renderHtmlToPdf } from "./chromium-pdf";
import type { RenderInput, RenderResult } from "./renderers";

/**
 * The structured résumé PDF path: `input.resume` (a `StructuredResume` +
 * `ResumeHeader`, set by `export-service` when the artifact's current version
 * carries `resumeData`) → a clean, résumé-appropriate print-styled HTML
 * document, rendered by headless Chromium via `renderHtmlToPdf` (shared with
 * the builtin renderer). Distinct from the cover-letter auto-layout: a
 * dedicated section-heading layout (SUMMARY / EXPERIENCE / EDUCATION /
 * SKILLS), tighter line-height, skipping empty sections — mirroring
 * `serializeResume`'s section rules so the text and PDF renditions agree.
 */
export async function renderResume(input: RenderInput): Promise<RenderResult> {
  let html: string;
  try {
    html = buildResumeHtml(input);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "resume render failed" };
  }
  return renderHtmlToPdf(html);
}

/** Contact line: email/phone/location/links, joined with " · ", empties skipped. */
function buildContactLine(header: ResumeHeader): string {
  const parts = [header.email, header.phone, header.location, ...(header.links ?? [])].filter(
    (v): v is string => Boolean(v && v.trim() !== ""),
  );
  return parts.map(escapeHtml).join(" &middot; ");
}

/** One EXPERIENCE entry: title — company (dates), then a bullet list. */
function buildExperienceEntry(exp: StructuredResume["experience"][number]): string {
  const bullets = exp.bullets
    .filter((b) => b.trim() !== "")
    .map((b) => `<li>${escapeHtml(b)}</li>`)
    .join("\n");
  return [
    '<div class="entry">',
    `  <div class="entry-head"><span class="entry-title">${escapeHtml(exp.title)} &mdash; ${escapeHtml(exp.company)}</span><span class="entry-dates">${escapeHtml(exp.dates)}</span></div>`,
    bullets ? `  <ul>\n${bullets}\n  </ul>` : "",
    "</div>",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** One EDUCATION entry: degree, field — school (dates), then optional details. */
function buildEducationEntry(edu: StructuredResume["education"][number]): string {
  const title = [edu.degree, edu.field].filter((v) => v.trim() !== "").join(", ");
  return [
    '<div class="entry">',
    `  <div class="entry-head"><span class="entry-title">${escapeHtml(title)} &mdash; ${escapeHtml(edu.school)}</span><span class="entry-dates">${escapeHtml(edu.dates)}</span></div>`,
    edu.details.trim() ? `  <p class="entry-details">${escapeHtml(edu.details)}</p>` : "",
    "</div>",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** A section with a heading, skipped entirely when `bodyHtml` is empty. */
function buildSection(heading: string, bodyHtml: string): string {
  if (bodyHtml.trim() === "") return "";
  return `<section>\n  <h2>${heading}</h2>\n${bodyHtml}\n</section>`;
}

/**
 * Builds the render-ready résumé HTML: header (name/contact), then SUMMARY,
 * EXPERIENCE, EDUCATION, SKILLS — each skipped when empty, mirroring
 * `serializeResume`. Throws if `input.resume` is absent; `renderResume` turns
 * that into an `{ok:false}` result. Every résumé/header string is escaped.
 */
export function buildResumeHtml(input: RenderInput): string {
  const resume = input.resume;
  if (!resume) {
    throw new Error("resume renderer requires input.resume (StructuredResume + ResumeHeader)");
  }
  const { data, header } = resume;

  const contactLine = buildContactLine(header);
  const headerHtml = [
    `<h1>${escapeHtml(header.name)}</h1>`,
    contactLine ? `<div class="contact">${contactLine}</div>` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const sections = [
    buildSection("Summary", data.summary.trim() ? `  <p>${escapeHtml(data.summary)}</p>` : ""),
    buildSection(
      "Experience",
      data.experience
        .filter((exp) => !isBlankExperience(exp))
        .map(buildExperienceEntry)
        .join("\n"),
    ),
    buildSection(
      "Education",
      data.education
        .filter((edu) => !isBlankEducation(edu))
        .map(buildEducationEntry)
        .join("\n"),
    ),
    buildSection(
      "Skills",
      data.skills.length ? `  <p>${data.skills.map(escapeHtml).join(", ")}</p>` : "",
    ),
  ].filter((s) => s !== "");

  const bodyHtml = [headerHtml, ...sections].join("\n");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(header.name || input.meta.title)}</title>
<style>${PRINT_STYLE}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/** Print CSS for the structured résumé: sans-serif, tighter line-height and
 *  section headings — distinct from the cover-letter auto-layout's serif body. */
const PRINT_STYLE = `
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    color: #1a1a1a;
    background: #ffffff;
    font-size: 10.5pt;
    line-height: 1.35;
  }
  h1 { font-size: 19pt; font-weight: 700; margin: 0 0 3pt; letter-spacing: -0.01em; }
  .contact { font-size: 9.5pt; color: #444; margin-bottom: 12pt; }
  section { margin-bottom: 10pt; }
  h2 {
    font-size: 10.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1pt solid #ccc;
    margin: 0 0 6pt;
    padding-bottom: 2pt;
  }
  .entry { margin-bottom: 8pt; }
  .entry-head { display: flex; justify-content: space-between; font-size: 10.5pt; margin-bottom: 2pt; }
  .entry-title { font-weight: 600; }
  .entry-dates { color: #555; white-space: nowrap; }
  .entry-details { margin: 0; }
  ul { margin: 0; padding-left: 14pt; }
  li { margin: 0 0 2pt; }
  p { margin: 0; }
`;
