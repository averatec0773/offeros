import { z } from "zod";

export const TEMPLATE_KINDS = ["cover-letter"] as const; // registry list, NOT a zod enum
export const TEMPLATE_RENDERERS = ["latex", "builtin"] as const; // registry list, NOT a zod enum

export const templateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1), // validated against a registry at the service layer
  renderer: z.string().min(1),
  content: z.string(), // tex source with body markers, or builtin HTML-fragment scaffold with body markers
  scaffoldHints: z.string().default(""), // salutation/closing/paragraph rules fed to generation
  isDefault: z.boolean().default(false),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Template = z.infer<typeof templateSchema>;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export type TemplateRenderer = (typeof TEMPLATE_RENDERERS)[number];

export const BODY_START = "%% OFFEROS-BODY-START";
export const BODY_END = "%% OFFEROS-BODY-END";

export type TemplateErrorKind = "no-body-markers" | "markers-out-of-order";

export class TemplateError extends Error {
  constructor(
    readonly kind: TemplateErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "TemplateError";
  }
}

/**
 * Locates the marker pair. BODY_START is taken at its first occurrence;
 * BODY_END is taken at its LAST occurrence — the real closing marker is
 * textually last, which keeps this correct even if the body between the
 * markers contains stray marker-like text (e.g. an LLM echoing the marker
 * back in generated content).
 */
function findMarkers(templateContent: string): { startIdx: number; endIdx: number } {
  const startIdx = templateContent.indexOf(BODY_START);
  const endIdx = templateContent.lastIndexOf(BODY_END);

  if (startIdx === -1 || endIdx === -1) {
    throw new TemplateError("no-body-markers", "Template content is missing body markers");
  }
  if (endIdx < startIdx) {
    throw new TemplateError("markers-out-of-order", "BODY_END appears before BODY_START");
  }

  return { startIdx, endIdx };
}

/** Strips any line that contains a literal marker string — a body must never introduce markers. */
function sanitizeBody(body: string): string {
  return body
    .split("\n")
    .filter((line) => !line.includes(BODY_START) && !line.includes(BODY_END))
    .join("\n");
}

/**
 * Replaces the region between BODY_START and BODY_END with `body`, keeping both
 * marker lines in place so re-injection stays idempotent. Everything before the
 * BODY_START line and everything from the BODY_END line onward is byte-identical
 * to the input. `body` is sanitized first (lines containing a literal marker are
 * dropped) so injected content can never fake or collide with a marker.
 */
export function injectBody(templateContent: string, body: string): string {
  const { startIdx, endIdx } = findMarkers(templateContent);
  const sanitizedBody = sanitizeBody(body);

  const before = templateContent.slice(0, startIdx + BODY_START.length);
  const after = templateContent.slice(endIdx);

  return `${before}\n${sanitizedBody}\n${after}`;
}

/** Returns the current body between the markers, or null if the markers are absent/malformed. */
export function extractBodyRegion(templateContent: string): string | null {
  try {
    const { startIdx, endIdx } = findMarkers(templateContent);
    return templateContent.slice(startIdx + BODY_START.length, endIdx).trim();
  } catch {
    return null;
  }
}
