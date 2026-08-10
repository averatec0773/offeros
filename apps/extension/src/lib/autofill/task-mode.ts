import { isCoverLetterLabel, type FieldDescriptor, type FieldTrace } from "@offeros/autofill";
import type { FieldReport, FieldReportOutcome, FillTicket } from "../offeros-api";

/**
 * Task mode: pure helpers for the fill-handoff flow. No DOM, no IO —
 * everything here is unit-tested and shared by the panel wiring. When no
 * ticket is claimed the panel never calls any of this.
 */

/** Report-side source vocabulary (mirrors @offeros/core's fieldReport `source`). */
export type FieldReportSource =
  | "personal"
  | "answer-bank"
  | "skills"
  | "ai-generated"
  | "cover-letter"
  | "resume-file"
  | "cover-letter-file"
  | "none";

/** One OfferOS-managed file kind a file input can classify as — the only
 *  kinds the panel ever auto-attaches. Maps to the report source vocabulary. */
export const FILE_KIND_SOURCE: Record<"resume" | "coverLetter", FieldReportSource> = {
  resume: "resume-file",
  coverLetter: "cover-letter-file",
};

/** A file field the panel manages (résumé/cover-letter) but a fetch 404'd —
 *  no stored file to attach, whether from a stale attachResume preference or
 *  an out-of-band deletion. Distinct from CUSTOM_UPLOADER_REASON below. */
export const NO_FILE_REASON = "No file available to attach — attach it manually.";

/** A file field the panel manages, but the fetch came back 400 — the artifact
 *  exists but failed to render into a PDF. Distinct from NO_FILE_REASON (404,
 *  nothing stored at all): this tells the user to go check the artifact
 *  instead of implying there's simply nothing to attach. */
export const RENDER_FAILED_REASON =
  "Couldn't generate the file to attach — check the artifact in OfferOS.";

/** A file field whose programmatic attach didn't verify (the site ignored or
 *  cleared the assignment), or any file field OfferOS never attempts to manage. */
export const CUSTOM_UPLOADER_REASON =
  "This site uses a custom uploader — attach the file manually.";

const CLOSED: ReadonlySet<FillTicket["status"]> = new Set(["completed", "cancelled"]);

function applyLinkOf(t: FillTicket): string | undefined {
  return t.applyLink ?? t.job.applyLink;
}

// Board hosts that serve MANY companies, where the first path segment is the
// company (tenant) slug. A bare hostname match on these would claim a ticket
// for a completely different employer's posting.
const MULTI_TENANT_HOSTS: ReadonlySet<string> = new Set([
  "jobs.ashbyhq.com",
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.eu.lever.co",
]);

/** Host plus, on multi-tenant board hosts, the company slug — the unit two
 *  URLs must share before a same-site fallback claim is allowed. */
function tenantOf(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (!MULTI_TENANT_HOSTS.has(host)) return host;
    const first = u.pathname.split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
    // Greenhouse embed routes (/embed/job_app?for=<org>&token=<id>) carry the
    // company in the QUERY, and their first path segment — "embed" — is shared
    // by every company on the host. Ten live fills proved what that does: any
    // old embed tab's panel tenant-matched any new embed ticket and claimed it
    // out from under the tab it was bound to. The company slug for these URLs
    // is `for=`, and an embed URL without one identifies nobody.
    if (first === "embed") {
      const org = u.searchParams.get("for")?.toLowerCase() ?? "";
      return org ? `${host}/${org}` : null;
    }
    return first ? `${host}/${first}` : host;
  } catch {
    return null;
  }
}

/**
 * Pick the handoff a claimed page belongs to. Precedence:
 *   1) a ticket whose applyLink parses to the same ATS job id as the page URL,
 *   2) else a ticket whose applyLink shares the page's tenant (hostname, plus
 *      the company slug on multi-tenant board hosts like jobs.ashbyhq.com —
 *      a bare host match would hand another employer's ticket to this page),
 *   3) else, if exactly one open ticket exists AND it carries no applyLink to
 *      compare (a linkable ticket that didn't match above belongs elsewhere),
 *      that ticket,
 *   4) else null (ambiguous → no handoff claimed).
 * `jobIdFromUrl` is injected (the extension's recipes.jobIdFromUrl); it returns
 * "" or null when no id can be parsed, both treated as "no id".
 */
export function matchHandoff(
  tickets: FillTicket[],
  pageUrl: string,
  jobIdFromUrl: (url: string) => string | null,
): FillTicket | null {
  const open = tickets.filter((t) => !CLOSED.has(t.status));
  if (open.length === 0) return null;

  const pageJobId = jobIdFromUrl(pageUrl) || null;
  if (pageJobId) {
    const byId = open.find((t) => {
      const link = applyLinkOf(t);
      if (!link) return false;
      const id = jobIdFromUrl(link) || null;
      return id !== null && id === pageJobId;
    });
    if (byId) return byId;
  }

  const pageTenant = tenantOf(pageUrl);
  if (pageTenant) {
    const byTenant = open.find((t) => {
      const link = applyLinkOf(t);
      return link ? tenantOf(link) === pageTenant : false;
    });
    if (byTenant) return byTenant;
  }

  if (open.length === 1 && !applyLinkOf(open[0]!)) return open[0]!;
  return null;
}

/** True when a field label reads like a cover-/motivation-letter free-text box.
 *  Delegates to @offeros/autofill's isCoverLetterLabel — the same norm()-based
 *  matcher the classifier uses for the cover-letter file kind, so the two
 *  paths never disagree on punctuation (they used to: "Cover-Letter" matched
 *  only one of the two before this shared). */
export const isCoverLetterField = isCoverLetterLabel;

// descriptor.type values scanFields (dom-fill.ts describe()) produces for a
// control a human answers with free-form prose: the plain text-ish <input>
// types, a bare <input> with no type attribute at all (its type resolves to
// the tag name "input", not "text" — describe() falls back to el.tagName when
// the attribute is absent), and <textarea>. Deliberately excludes number/date/
// password: setControlledValue's value-setter silently coerces an unparsable
// string to "" on those types (per the HTML value sanitization algorithm),
// which would reproduce the same "reported filled, actually empty" failure —
// and select/checkbox/radio/file are never valid free-text targets at all.
const TEXT_ANSWER_TYPES: ReadonlySet<string> = new Set([
  "input",
  "text",
  "textarea",
  "email",
  "tel",
  "url",
  "search",
]);

/**
 * True when a field descriptor can be a text-answer write target — cover-letter
 * paste and AI-generated answers only ever belong in genuinely free-text
 * controls. Anything not in the allowlist (select, checkbox, radio, file,
 * number, date, …) must never be selected here; it falls through to
 * buildFieldReports' existing needs-user path instead.
 */
export function isTextAnswerTarget(desc: Pick<FieldDescriptor, "type">): boolean {
  return TEXT_ANSWER_TYPES.has(desc.type);
}

/** Map an engine trace's `source` (+ classified type) to the report vocabulary. */
function traceSource(t: FieldTrace): FieldReportSource {
  if (t.classifiedType === "skills") return "skills";
  switch (t.source) {
    case "personal":
      return "personal";
    case "answerBank":
      return "answer-bank";
    case "generate":
      return "ai-generated";
    case "none":
      return "none";
  }
}

/**
 * A DOM write outcome for one field. The bare string form covers classified/
 * personal fields (the engine already knows their value & source); the object
 * form carries the value and an explicit source for task-mode-only writes
 * (AI-generated answers, cover-letter verbatim, file attaches) the engine
 * trace can't describe. `outcome: "needs-user"` + `reason` lets a file-attach
 * attempt that didn't pan out (no file to fetch, or a failed DOM verify)
 * override the trace's default classify-time reason with the exact
 * NO_FILE_REASON / CUSTOM_UPLOADER_REASON text.
 */
export type WriteOutcome =
  | "filled"
  | "failed"
  | {
      outcome: "filled" | "failed" | "needs-user";
      value?: string;
      source?: FieldReportSource;
      reason?: string;
    };

function normalize(w: WriteOutcome | undefined):
  | {
      outcome: "filled" | "failed" | "needs-user";
      value?: string;
      source?: FieldReportSource;
      reason?: string;
    }
  | undefined {
  if (w === undefined) return undefined;
  return typeof w === "string" ? { outcome: w } : w;
}

/**
 * Turn an engine trace + the actual per-field DOM write outcomes into the
 * FieldReport[] the workspace consumes. Pure: outcome is derived from whether/
 * how the field was written, requiredness from `requiredIds`, and `page` tags
 * every row so the server can accumulate across wizard steps.
 *   - written filled/failed/needs-user → that outcome (value/source/reason from
 *     the write if given — a file-attach attempt overrides the reason this way),
 *   - unwritten needs-answer (file inputs, resume, ungenerated) → needs-user,
 *   - unwritten unknown/fillable → skipped.
 */
export function buildFieldReports(
  trace: FieldTrace[],
  writes: Map<string, WriteOutcome>,
  requiredIds: Set<string>,
  page: string,
): FieldReport[] {
  return trace.map((t): FieldReport => {
    const w = normalize(writes.get(t.fieldId));
    let outcome: FieldReportOutcome;
    if (w) outcome = w.outcome;
    else if (t.status === "needs-answer") outcome = "needs-user";
    else outcome = "skipped";

    const value = w?.value ?? (t.chosenValue || undefined);
    return {
      fieldId: t.fieldId,
      label: t.label,
      classifiedType: t.classifiedType,
      status: t.status,
      value: outcome === "filled" ? value : t.chosenValue || undefined,
      source: w?.source ?? traceSource(t),
      reason: w?.reason ?? t.reason,
      outcome,
      required: requiredIds.has(t.fieldId),
      page,
      questionKey: t.questionKey,
    };
  });
}
