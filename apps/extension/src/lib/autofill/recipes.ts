export type AtsId = "greenhouse" | "lever" | "ashby" | "icims" | "myworkday" | "generic";

export interface AtsRecipe {
  atsId: AtsId;
  urlPatterns: RegExp[];
  formSelector: string;
  fieldSelector: string;
  /** Scan through open shadow roots too (Workday renders inputs in shadow DOM). */
  pierceShadow?: boolean;
}

const FIELDS = "input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea";

// Workday renders its dropdowns as custom widgets, not <select>: a
// <button aria-haspopup="listbox" id name> inside a
// div[data-automation-id^="formField-"], with a <label for> pointing at the
// button's id and the current value as the button's text (verified live on a
// wd1.myworkdayjobs.com tenant, 2026-08-10). Without the button in the field
// selector, a wizard page made only of these (Application Questions) scans as
// "no form". Workday-only — other ATSs keep the plain selector.
const WORKDAY_FIELDS = `${FIELDS}, button[aria-haspopup="listbox"]`;

export const RECIPES: AtsRecipe[] = [
  {
    atsId: "greenhouse",
    urlPatterns: [
      /^https?:\/\/boards\.greenhouse\.io\//i,
      /^https?:\/\/job-boards\.greenhouse\.io\//i,
      /^https?:\/\/[a-z0-9-]+\.greenhouse\.io\//i,
    ],
    formSelector: "form#application_form, form[action*='application'], main form",
    fieldSelector: FIELDS,
  },
  {
    atsId: "lever",
    urlPatterns: [/^https?:\/\/jobs\.lever\.co\//i, /^https?:\/\/jobs\.eu\.lever\.co\//i],
    formSelector: "form#application-form, form[action*='apply'], main form",
    fieldSelector: FIELDS,
  },
  {
    atsId: "ashby",
    // Ashby renders the application as a React SPA; scanFields falls back to
    // the document root when no <form> matches, so a plain form selector is safe.
    urlPatterns: [/^https?:\/\/jobs\.ashbyhq\.com\//i, /^https?:\/\/[a-z0-9-]+\.ashbyhq\.com\//i],
    formSelector: "form",
    fieldSelector: FIELDS,
  },
  {
    atsId: "icims",
    // careers-*.icims.com portals; login.icims.com must NOT match.
    urlPatterns: [/^https?:\/\/(?!login\.)[a-z0-9-]+\.icims\.com\//i],
    formSelector: "form",
    fieldSelector: FIELDS,
  },
  {
    atsId: "myworkday",
    // Workday external tenants: <tenant>.<dc>.myworkdayjobs.com (e.g.
    // intel.wd1.myworkdayjobs.com). The trailing `\/` after the domain rejects
    // spoofs like myworkdayjobs.com.evil.com. The application is a React SPA, so
    // scanFields falls back to the document root when no <form> matches.
    urlPatterns: [/^https?:\/\/([a-z0-9-]+\.)*myworkdayjobs\.com\//i],
    formSelector: "form",
    fieldSelector: WORKDAY_FIELDS,
    pierceShadow: true,
  },
];

/**
 * The recipe for a site nobody has written a recipe for.
 *
 * Not in `RECIPES`, and deliberately not reachable by URL: `matchAts` still
 * answers null for an unknown host, so nothing about automatic injection
 * changes. This is only handed out once the user has said "run here", and it
 * carries no site knowledge at all — a plain form selector and the plain field
 * list. Everything clever about an unknown page has to come from the field
 * classifier and the generic driver, not from a guess encoded here.
 */
export const GENERIC_RECIPE: AtsRecipe = {
  atsId: "generic",
  urlPatterns: [],
  formSelector: "form",
  // Native controls plus the ARIA ones. A site nobody wrote a driver for is
  // exactly where a custom widget is likeliest, and a widget the scan never
  // sees is a field the panel cannot even tell the user about. Roles only —
  // no class names, no framework internals; whatever the page published about
  // itself for a screen reader is all this knows.
  fieldSelector: `${FIELDS}, [role="combobox"], [role="listbox"], [aria-haspopup="listbox"], [aria-haspopup="menu"], [role="radiogroup"]`,
};

/**
 * Does this page look like something worth offering to fill?
 *
 * The conservative half of enabling an arbitrary site. A blog's comment box and
 * a newsletter signup are forms; treating them as application forms would put
 * the user's phone number in a comment field. So a form has to look like an
 * application: it either takes a file (a résumé upload is close to conclusive)
 * or it asks at least three labelled questions. One search box does not
 * qualify, and neither does a two-field login.
 *
 * Wrong in the safe direction on purpose. A missed application form leaves the
 * user where they already were — filling it themselves — while a false positive
 * spends their data on a page that never asked for it.
 */
const MIN_LABELLED_FIELDS = 3;

export function looksLikeApplicationForm(root: ParentNode): boolean {
  // A document with nothing to read is not an application form. Callers reach
  // this from the engine, which may be handed a document that has not rendered.
  if (typeof root?.querySelectorAll !== "function") return false;
  const forms = [...root.querySelectorAll("form")];
  const scopes: ParentNode[] = forms.length > 0 ? forms : [root];
  return scopes.some((scope) => {
    if (scope.querySelector("input[type=file]")) return true;
    const fields = [...scope.querySelectorAll(FIELDS)];
    const labelled = fields.filter((el) => {
      const id = el.getAttribute("id");
      const hasLabel = id ? scope.querySelector(`label[for="${CSS.escape(id)}"]`) !== null : false;
      return (
        hasLabel ||
        el.getAttribute("aria-label") !== null ||
        el.getAttribute("aria-labelledby") !== null ||
        el.closest("label") !== null
      );
    });
    return labelled.length >= MIN_LABELLED_FIELDS;
  });
}

export function matchAts(url: string): AtsRecipe | null {
  for (const recipe of RECIPES) {
    if (recipe.urlPatterns.some((re) => re.test(url))) return recipe;
  }
  return null;
}

const SHARED_JOB_HOSTS = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.eu.lever.co",
  "jobs.ashbyhq.com",
]);

/**
 * Company slug for the application log: first path segment on shared
 * job-board hosts (boards.greenhouse.io/acme), else the first host label
 * (acme.greenhouse.io). Empty string when the URL cannot be parsed.
 */
export function companyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    if (SHARED_JOB_HOSTS.has(u.hostname.toLowerCase())) {
      const first = u.pathname.split("/").filter(Boolean)[0] ?? "";
      // Greenhouse's embedded apply route (/embed/job_app?for=acme&token=…)
      // carries the org in ?for=, not the path — "embed" is never a company.
      if (first === "embed") return u.searchParams.get("for") ?? "";
      return first;
    }
    const label = u.hostname.split(".")[0] ?? "";
    return label.startsWith("careers-") ? label.slice("careers-".length) : label;
  } catch {
    return "";
  }
}

/**
 * Company from an ATS document-title convention — currently Greenhouse's
 * "Job Application for {title} at {company}". The greedy first group splits on
 * the LAST " at ", so a job title containing " at " stays in the title side.
 * Empty string when the title doesn't match any known convention.
 */
export function companyFromDocTitle(title: string): string {
  const m = /^Job application for (.+) at (.+)$/i.exec(title.trim());
  return m?.[2]?.trim() ?? "";
}

const JOB_ID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ATS job id from a job URL: Greenhouse `/jobs/<id>`, else the path's UUID
 * segment (Lever/Ashby). Empty string when absent or unparseable.
 */
export function jobIdFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    const jobsIdx = segments.indexOf("jobs");
    if (jobsIdx !== -1 && segments[jobsIdx + 1]) return segments[jobsIdx + 1]!;
    const uuid = segments.find((s) => JOB_ID_UUID.test(s));
    if (uuid) return uuid;
    // Greenhouse embed/board routes carry the id only in the query:
    // gh_jid on career-site embeds, token on /embed/job_app. Greenhouse-only —
    // "token" is too generic to trust on other hosts.
    if (u.hostname.toLowerCase().endsWith("greenhouse.io")) {
      return u.searchParams.get("gh_jid") ?? u.searchParams.get("token") ?? "";
    }
    return "";
  } catch {
    return "";
  }
}
