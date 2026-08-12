import { questionKey, toControl, type FieldDescriptor, type FieldMeta } from "@offeros/autofill";
// One parser, shared with the dedup path: a link this can read is a link the
// "already added?" check can identify, and the two must never disagree.
import { parseGreenhouseUrl } from "../../job-url";
import { safeFetch } from "../../net/safe-fetch";
import type { AtsRecon, ReconQuestion, ReconVerdict } from "./types";

/**
 * Greenhouse, read through its own public job-board API.
 *
 * The API is the point. Scraping the apply page would mean parsing HTML we do
 * not control and guessing at which inputs are questions; the board API states
 * the questions, their types, their options and which are required, in the
 * platform's own words — the same words the fill engine reads off the page
 * later, which is what lets a question learned here and a question met during
 * a real fill share one key.
 *
 * Nothing here calls a model. Every judgement below is a string comparison
 * against markup Greenhouse itself emits.
 */

/** The shape of the board API's answer, narrowed to what we read. */
interface BoardJob {
  title?: unknown;
  content?: unknown;
  absolute_url?: unknown;
  location?: { name?: unknown } | null;
  company_name?: unknown;
  questions?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Greenhouse's own "this job is closed" copy.
 *
 * Kept as data rather than one regex so a reader can see exactly which strings
 * are being trusted, and so adding a wording costs one line. Matched against
 * lowercased page text.
 */
const CLOSED_MARKERS = [
  "this job is no longer available",
  "no longer accepting applications",
  "this position is no longer open",
  "the job you are looking for is no longer open",
  "job is no longer posted",
];

/** Does this page say, in the platform's own words, that the job is closed? */
export function greenhouseClosedMarker(html: string): boolean {
  const text = html.toLowerCase();
  return CLOSED_MARKERS.some((marker) => text.includes(marker));
}

/**
 * Translate one board-API question into the shape the fill engine speaks.
 *
 * A Greenhouse "question" can own several fields (a compound address, a
 * yes/no with a follow-up). The first field carries the type and the options,
 * which is what identity is computed from.
 */
function toQuestion(raw: unknown): ReconQuestion | null {
  if (typeof raw !== "object" || raw === null) return null;
  const q = raw as { label?: unknown; required?: unknown; fields?: unknown };
  const label = str(q.label).trim();
  if (label === "") return null;
  const fields = Array.isArray(q.fields) ? q.fields : [];
  const first = (fields[0] ?? {}) as { type?: unknown; values?: unknown; name?: unknown };
  const control = toControl(str(first.type));
  const options = Array.isArray(first.values)
    ? first.values
        .map((v) =>
          typeof v === "object" && v !== null ? str((v as { label?: unknown }).label) : "",
        )
        .filter((v) => v !== "")
    : [];

  // Identity is computed with the SAME function a real fill uses, from the
  // same three inputs, so the two sightings collapse onto one row rather than
  // recording the question twice.
  const meta: FieldMeta = {
    question: label,
    control,
    groupId: str(first.name) || label,
    required: q.required === true,
    ...(options.length > 0 ? { options } : {}),
    source: "props",
  };
  const descriptor: FieldDescriptor = {
    fieldId: str(first.name),
    label,
    name: str(first.name),
    autocomplete: "",
    type: str(first.type),
    placeholder: "",
    ariaLabel: "",
    required: q.required === true,
    ...(options.length > 0 ? { options } : {}),
  };

  return {
    questionKey: questionKey(meta, descriptor),
    question: label,
    control,
    required: q.required === true,
  };
}

export interface GreenhouseJob {
  title: string;
  company: string;
  location: string;
  /** The posting body, as HTML entities-encoded markup from the API. */
  contentHtml: string;
  questions: ReconQuestion[];
}

/** Parse a board-API job payload. Returns null when it is not one. */
export function parseGreenhouseJob(payload: unknown): GreenhouseJob | null {
  if (typeof payload !== "object" || payload === null) return null;
  const job = payload as BoardJob;
  const title = str(job.title).trim();
  if (title === "") return null;
  const questions = Array.isArray(job.questions)
    ? job.questions.map(toQuestion).filter((q): q is ReconQuestion => q !== null)
    : [];
  return {
    title,
    company: str(job.company_name).trim(),
    location: str(job.location?.name).trim(),
    contentHtml: str(job.content),
    questions,
  };
}

export { parseGreenhouseUrl };

export const GREENHOUSE_API = "https://boards-api.greenhouse.io";

/**
 * Ask the board API about one posting.
 *
 * A 404 here is a real answer, not a failure: Greenhouse removes a job from
 * its board when it closes, so "the API does not have it" IS the closure
 * signal. Anything else that goes wrong stays `unknown` — see the service.
 */
export async function fetchGreenhouse(
  token: string,
  jobId: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  resolve?: (hostname: string) => Promise<string[]>,
): Promise<{ verdict: ReconVerdict; job: GreenhouseJob | null }> {
  const url = `${GREENHOUSE_API}/v1/boards/${encodeURIComponent(token)}/jobs/${encodeURIComponent(jobId)}?questions=true`;
  const result = await safeFetch(url, {
    fetchImpl,
    ...(resolve ? { resolve } : {}),
    ...(signal ? { signal } : {}),
  });
  if (!result.ok) return { verdict: "unknown", job: null };
  if (result.response.status === 404 || result.response.status === 410) {
    return { verdict: "closed", job: null };
  }
  if (result.response.status >= 400) return { verdict: "unknown", job: null };
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(result.bytes));
  } catch {
    return { verdict: "unknown", job: null };
  }
  const job = parseGreenhouseJob(payload);
  return { verdict: job ? "open" : "unknown", job };
}

export const greenhouseRecon: AtsRecon = {
  vendor: "greenhouse",
  matches: (url) => parseGreenhouseUrl(url) !== null,
  closedMarker: greenhouseClosedMarker,
  probe: async (url, fetchImpl, signal, resolve) => {
    const parsed = parseGreenhouseUrl(url);
    if (!parsed) return null;
    const { verdict, job } = await fetchGreenhouse(
      parsed.token,
      parsed.jobId,
      fetchImpl,
      signal,
      resolve,
    );
    return {
      verdict,
      ...(job
        ? {
            job: {
              title: job.title,
              company: job.company,
              location: job.location,
              descriptionHtml: job.contentHtml,
            },
            questions: job.questions,
          }
        : {}),
    };
  },
};
