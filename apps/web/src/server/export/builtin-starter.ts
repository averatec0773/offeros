import { BODY_END, BODY_START } from "@offeros/core";

/**
 * Starter content for a brand-new editable built-in cover-letter template.
 * Loaded when a no-LaTeX user creates their first `renderer: "builtin"`
 * template so they get a real, previewable document instead of a blank
 * textarea — a placeholder sender block, a generic salutation, the body slot
 * (between the markers, filled by `injectBody`), and a generic closing. All
 * placeholder text is meant to be edited by the user before their first send.
 *
 * This is a plain HTML fragment (no `<html>`/`<body>` wrapper) — the renderer
 * wraps it with the shared print CSS. It has no `node:` imports so it can
 * also be imported client-side (e.g. by a template editor).
 */
export const BUILTIN_STARTER = `<p>Your Name<br>
your.email@example.com<br>
Your City, ST</p>

<p>Dear Hiring Team,</p>

${BODY_START}
${BODY_END}

<p>Sincerely,<br>
Your Name</p>
`;
