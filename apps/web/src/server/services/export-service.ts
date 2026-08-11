import { randomUUID } from "node:crypto";
import {
  buildResumeHeader,
  type Artifact,
  type ArtifactKind,
  type ArtifactVersion,
  type Template,
} from "@offeros/core";
import type { Db } from "../db/client";
import { getPipelineTask } from "../repositories/pipeline-task-repo";
import { getApplication } from "../repositories/application-repo";
import { getArtifact } from "../repositories/artifact-repo";
import { getProfile } from "../repositories/profile-repo";
import { getDefaultTemplate, getTemplate } from "../repositories/template-repo";
import { hasPdflatex } from "../export/latex-renderer";
import { RENDERERS, type RenderInput, type RenderResult } from "../export/renderers";

/** An artifact's current version, or null when the artifact is absent. */
function currentVersion(artifact: Artifact | null): ArtifactVersion | null {
  if (!artifact) return null;
  return artifact.versions.find((v) => v.id === artifact.currentVersionId) ?? null;
}

const TITLES: Record<ArtifactKind, string> = {
  resume: "Resume",
  "cover-letter": "Cover Letter",
};

const FALLBACK_NOTE =
  "Rendered with the built-in PDF engine (no LaTeX template / pdflatex available).";

const NO_PDFLATEX_NOTE =
  "This template uses the LaTeX renderer, but pdflatex was not found on this machine. " +
  "Install a TeX distribution, or switch the template to the built-in renderer.";

/**
 * The single render seam shared by {@link exportArtifactPdf} and
 * {@link previewTemplate}: given a resolved renderer name + optional template,
 * dispatch to `RENDERERS` with the shared pdflatex guard. Sharing this path is
 * what makes "a successful preview implies a successful export" hold — a
 * template that previews via a renderer exports via the identical call.
 *
 * A `latex` renderer with pdflatex absent returns `{ ok: false }` with a clear
 * note rather than silently degrading; the built-in renderer is always
 * available. (Export's cover-letter path chooses to degrade to the built-in
 * renderer itself, before calling here — see below.) `resume` is a third,
 * template-free renderer driven by a structured payload instead of `template`.
 */
async function renderWith(
  renderer: string,
  template: Template | undefined,
  body: string,
  meta: RenderInput["meta"],
  resume?: RenderInput["resume"],
): Promise<RenderResult> {
  if (renderer === "latex") {
    if (!hasPdflatex()) return { ok: false, error: NO_PDFLATEX_NOTE };
    return RENDERERS.latex({ body, meta, template });
  }
  if (renderer === "resume") {
    return RENDERERS.resume({ body, meta, resume });
  }
  return RENDERERS.builtin({ body, meta, template });
}

/**
 * Render a task's artifact (`resume` | `cover-letter`) to PDF, choosing the
 * renderer by kind and available template/data:
 *
 *  - **cover-letter** with a default `latex` template and pdflatex present →
 *    the latex renderer (template markers + `injectBody`). No latex template OR
 *    pdflatex absent → builtin fallback, flagged via `result.note`. A latex
 *    compile error is returned as-is (with `logExcerpt`), NOT silently fallen
 *    back — the user should see and fix it.
 *  - **resume** with a structured current version (`resumeData` present) AND a
 *    saved profile → the résumé renderer, fed `resumeData` + the profile's
 *    contact header (`buildResumeHeader`). Either one missing (an artifact
 *    version from before Task 5, or no profile saved yet) → the builtin text
 *    render, unchanged from before this renderer existed.
 *
 * Returns `{ ok: false }` when the artifact has no current-version content; the
 * route is responsible for turning missing task/artifact into a 404.
 */
export async function exportArtifactPdf(
  db: Db,
  taskId: string,
  kind: ArtifactKind,
): Promise<RenderResult> {
  const version = currentVersion(getArtifact(db, taskId, kind));
  if (version == null) {
    return { ok: false, error: `no ${kind} artifact to export for task ${taskId}` };
  }
  const body = version.content;

  const task = getPipelineTask(db, taskId);
  const job = task ? getApplication(db, task.applicationId)?.jobInfo : undefined;
  const meta: RenderInput["meta"] = {
    title: TITLES[kind],
    jobTitle: job?.jobTitle,
    company: job?.companyName,
  };

  if (kind === "cover-letter") {
    const template = getDefaultTemplate(db, "cover-letter") ?? undefined;
    if (template?.renderer === "latex" && hasPdflatex()) {
      return renderWith("latex", template, body, meta);
    }
    // No latex template, or pdflatex absent → degrade to the built-in engine
    // (flagged), rather than failing the export.
    const result = await renderWith("builtin", template, body, meta);
    return result.ok ? { ...result, note: FALLBACK_NOTE } : result;
  }

  if (version.resumeData) {
    const profile = getProfile(db);
    if (profile) {
      const header = buildResumeHeader(profile);
      return renderWith("resume", undefined, body, meta, { data: version.resumeData, header });
    }
  }

  return renderWith("builtin", undefined, body, meta);
}

/**
 * A fixed, safe placeholder cover-letter body used only for template previews —
 * three neutral paragraphs so the user sees real layout (salutation → body →
 * closing) without any personal or job-specific content. Escaped by the
 * renderer exactly like a real body.
 */
export const SAMPLE_BODY = [
  "I am writing to express my strong interest in this position. The role aligns closely with my background, and I am excited by the opportunity to contribute to your team's work.",
  "In my previous roles I have delivered measurable results, collaborated across functions, and taken ownership of projects from design through delivery. I bring a track record of turning ambiguous problems into shipped, reliable solutions.",
  "I would welcome the chance to discuss how my experience can support your goals. Thank you for your time and consideration.",
].join("\n\n");

const SAMPLE_META: RenderInput["meta"] = {
  title: "Cover Letter",
  jobTitle: "Senior Software Engineer",
  company: "Acme Corporation",
};

/**
 * Render a template to a preview PDF using {@link SAMPLE_BODY} and sample meta,
 * through the SAME renderer seam as {@link exportArtifactPdf} — so a successful
 * preview implies a successful export of the saved template.
 *
 * Accepts either inline `{ content, renderer, scaffoldHints? }` (a not-yet-saved
 * template, e.g. the upload→confirm flow) or `{ id }` (an existing saved
 * template). A `latex` template with pdflatex absent yields `{ ok: false }`
 * with a clear note; an unknown `id` yields `{ ok: false }` (the route maps it
 * to a 404).
 */
export async function previewTemplate(
  db: Db,
  input: { content: string; renderer: string; scaffoldHints?: string } | { id: string },
): Promise<RenderResult> {
  let template: Template;
  if ("id" in input) {
    const found = getTemplate(db, input.id);
    if (!found) return { ok: false, error: `template ${input.id} not found` };
    template = found;
  } else {
    const now = Date.now();
    template = {
      id: randomUUID(),
      name: "Template Preview",
      kind: "cover-letter",
      renderer: input.renderer,
      content: input.content,
      scaffoldHints: input.scaffoldHints ?? "",
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  return renderWith(template.renderer, template, SAMPLE_BODY, SAMPLE_META);
}
