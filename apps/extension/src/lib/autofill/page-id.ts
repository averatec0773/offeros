import type { WizardState } from "@offeros/autofill";

/**
 * Which page of an application this is.
 *
 * This is the merge key half of every field report: the server keys reports by
 * `page + fieldId` and replaces matches, so two scans of the same page MUST
 * produce the same value here or the report set grows a duplicate copy of the
 * page every time anything about it changes.
 *
 * That is exactly what went wrong: the panel used to pass a hash of every field
 * id on the page. Perfect for noticing that a page changed, useless as an
 * identity — a conditional field appearing, or a validation error inserting a
 * node, changed the key of every field at once. Stale "needs you" rows then
 * survived forever and the application never left that state.
 *
 * So identity is built only from things that do NOT move when the form does:
 * the URL's path, and the wizard step when the page tells us one. Query strings
 * and fragments are excluded — trackers and anchors change without the page
 * changing.
 */
export function stablePageId(url: string, wizard?: WizardState | null): string {
  const step = wizardStep(wizard);
  let base: string;
  try {
    const parsed = new URL(url);
    // Host included: a multi-tenant ATS can serve two employers on paths that
    // look alike. Trailing slash dropped so "/apply" and "/apply/" are one page.
    base = (parsed.host + parsed.pathname).toLowerCase().replace(/\/+$/, "");
  } catch {
    // Not a URL we can parse — comparing the raw string is still stable, which
    // is the only property this needs.
    base = url.trim().toLowerCase();
  }
  return step ? `${base}#${step}` : base;
}

/**
 * The current step, when the page says which one it is on.
 *
 * Needed because a multi-page application can serve every step from one URL:
 * without this, page four's reports would overwrite page one's. The step
 * NUMBER is used rather than its label — labels get retitled, numbers do not.
 */
function wizardStep(wizard?: WizardState | null): string {
  return wizard?.current ? `step${wizard.current}` : "";
}
