export type AtsId = "greenhouse" | "lever" | "ashby" | "icims" | "myworkday";

export interface AtsRecipe {
  atsId: AtsId;
  urlPatterns: RegExp[];
  formSelector: string;
  fieldSelector: string;
  /** Scan through open shadow roots too (Workday renders inputs in shadow DOM). */
  pierceShadow?: boolean;
}

const FIELDS = "input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea";

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
    fieldSelector: FIELDS,
    pierceShadow: true,
  },
];

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
