import type { Template } from "@offeros/core";
import { renderBuiltin } from "./builtin-renderer";
import { renderLatex } from "./latex-renderer";

/** Everything a renderer needs to produce a PDF from an artifact's text. */
export type RenderInput = {
  /** Plain-text artifact body (current version content). */
  body: string;
  meta: { title: string; jobTitle?: string; company?: string };
  /** Present for template-driven renderers (latex); absent for the builtin. */
  template?: Template;
};

/**
 * A rendered PDF, or a structured failure. `note` carries a non-fatal remark on
 * success (e.g. "fell back to the builtin engine because pdflatex is absent");
 * `logExcerpt` carries the tail of a compiler log on failure.
 */
export type RenderResult =
  { ok: true; pdf: Buffer; note?: string } | { ok: false; error: string; logExcerpt?: string };

export type Renderer = (input: RenderInput) => Promise<RenderResult>;

/**
 * The build-for-change seam. `exportArtifactPdf` picks an entry by template /
 * kind rules; supporting a new output format is adding a key here, nothing more.
 */
export const RENDERERS: Record<string, Renderer> & { latex: Renderer; builtin: Renderer } = {
  latex: (input) => renderLatex(input),
  builtin: (input) => renderBuiltin(input),
};
