import type { Evidence, JobFields } from "./types";

/**
 * What any page can be asked, regardless of who runs it.
 *
 * Three readings, in descending order of how much the page meant them: the
 * structured data a site publishes for search engines, the social preview
 * tags, and finally whatever prose the server actually rendered. None of them
 * is reliable enough to build a product on — the page that motivated all of
 * this has no job data in its HTML at all — but each is free once the page has
 * been fetched for its fingerprint, so it would be silly not to look.
 */

/**
 * Markup to readable text.
 *
 * Entities are decoded BEFORE tags are stripped. That order is load-bearing:
 * some sources hand back the body escaped (`&lt;p&gt;…`), so stripping first
 * removes nothing and then reveals the markup as literal text. This was a real
 * bug once; do not swap these back.
 */
export function htmlToText(html: string): string {
  return (
    html
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
      // &amp; last of the named entities, so "&amp;lt;" does not become a tag.
      .replace(/&amp;/gi, "&")
      .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

/** Strip the parts of a document that are never prose. */
function stripNonContent(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Walk a JSON-LD value, which may be an object, an array, or a @graph. */
function* candidates(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const item of node) yield* candidates(item);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const record = node as Record<string, unknown>;
  yield record;
  if (record["@graph"]) yield* candidates(record["@graph"]);
}

function moneyFrom(salary: unknown): string {
  if (typeof salary !== "object" || salary === null) return "";
  const base = salary as { currency?: unknown; value?: unknown };
  const value = (base.value ?? {}) as {
    minValue?: unknown;
    maxValue?: unknown;
    value?: unknown;
    unitText?: unknown;
  };
  const currency = str(base.currency);
  const unit = str(value.unitText).toLowerCase();
  const min = typeof value.minValue === "number" ? value.minValue : undefined;
  const max = typeof value.maxValue === "number" ? value.maxValue : undefined;
  const flat = typeof value.value === "number" ? value.value : undefined;
  const amount =
    min !== undefined && max !== undefined
      ? `${min.toLocaleString()}–${max.toLocaleString()}`
      : (min ?? max ?? flat)?.toLocaleString();
  if (!amount) return "";
  return [currency, amount, unit ? `per ${unit}` : ""].filter(Boolean).join(" ").trim();
}

/**
 * schema.org JobPosting, when a site publishes one.
 *
 * The richest thing a page can hand over for free — it is the only generic
 * source that carries pay and a closing date. Plenty of sites do not publish
 * it; that is simply a miss, not a failure.
 */
export function fromJsonLd(html: string): Evidence | null {
  const blocks = [
    ...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block[1]!.trim());
    } catch {
      continue; // one malformed block must not stop the others
    }
    for (const node of candidates(parsed)) {
      const type = node["@type"];
      const types = Array.isArray(type) ? type.map(str) : [str(type)];
      if (!types.includes("JobPosting")) continue;

      const org = node.hiringOrganization as { name?: unknown } | undefined;
      const place = node.jobLocation as unknown;
      const address = (Array.isArray(place) ? place[0] : place) as
        { address?: { addressLocality?: unknown; addressRegion?: unknown } } | undefined;
      const locality = str(address?.address?.addressLocality);
      const region = str(address?.address?.addressRegion);

      const fields: JobFields = {};
      const title = str(node.title);
      if (title) fields.title = title;
      const company = str(org?.name);
      if (company) fields.company = company;
      const location = [locality, region].filter(Boolean).join(", ");
      if (location) fields.location = location;
      const description = str(node.description);
      if (description) fields.jdText = htmlToText(description);
      const salary = moneyFrom(node.baseSalary);
      if (salary) fields.salary = salary;
      const deadline = str(node.validThrough);
      if (deadline) fields.deadline = deadline;
      const posted = str(node.datePosted);
      if (posted) fields.postedAt = posted;

      if (Object.keys(fields).length === 0) continue;
      return { source: "page", fields };
    }
  }
  return null;
}

/** Open Graph / meta tags. Thin, but a title and a description cost nothing. */
export function fromMetaTags(html: string): Evidence | null {
  const meta = (property: string): string => {
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
      "i",
    );
    const alternate = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
      "i",
    );
    return str(pattern.exec(html)?.[1] ?? alternate.exec(html)?.[1] ?? "");
  };

  const fields: JobFields = {};
  const title = meta("og:title") || str(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
  if (title) fields.title = htmlToText(title);
  const site = meta("og:site_name");
  if (site) fields.company = htmlToText(site);

  return Object.keys(fields).length > 0 ? { source: "page", fields } : null;
}

/** Below this a blurb is a tagline, not even a summary of the job. */
const MIN_SUMMARY_CHARS = 80;

/**
 * The page's own one-paragraph blurb, as a description of last resort.
 *
 * Deliberately separate evidence from the title and company above, and
 * deliberately ranked below the rendered body: `og:description` is a sentence
 * written for a link preview, and it used to win against a complete
 * description purely because the meta collector runs first and equal ranks
 * keep whoever arrived first. Kept at all because on a page built entirely in
 * the browser it is the only thing a server can see — but labelled, so the UI
 * can say so and point at the panel, which CAN read the rendered page.
 */
export function fromMetaSummary(html: string): Evidence | null {
  const meta = (property: string): string => {
    const pattern = new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
      "i",
    );
    const alternate = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
      "i",
    );
    return str(pattern.exec(html)?.[1] ?? alternate.exec(html)?.[1] ?? "");
  };
  const description = htmlToText(meta("og:description") || meta("description"));
  if (description.length < MIN_SUMMARY_CHARS) return null;
  return { source: "page-summary", fields: { jdText: description } };
}

/** How much rendered prose is worth treating as a description. Below this it
 *  is navigation and boilerplate, not a posting. */
const MIN_BODY_CHARS = 400;

/**
 * The prose the server actually rendered.
 *
 * Last resort among the generic readings, and often empty: a page built by
 * JavaScript has none of its content here. When that happens the honest answer
 * is that this is a page for the browser to read, not the server.
 */
export function fromRenderedText(html: string): Evidence | null {
  const main =
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ??
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] ??
    /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ??
    html;
  const text = htmlToText(stripNonContent(main));
  if (text.length < MIN_BODY_CHARS) return null;
  return { source: "page", fields: { jdText: text } };
}

/** Every generic reading of one page, best first. */
export function readPage(html: string): Evidence[] {
  return [
    fromJsonLd(html),
    fromMetaTags(html),
    fromRenderedText(html),
    // Last, and ranked lowest: only reached when nothing above had a body.
    fromMetaSummary(html),
  ].filter((e): e is Evidence => e !== null);
}
