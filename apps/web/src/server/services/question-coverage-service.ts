import { classifyField, guardClassOf, matchAnswer } from "@offeros/autofill";
import type {
  AnswerGap,
  AnswerGaps,
  CoverageScope,
  CoveredQuestion,
  ObservedQuestion,
  Profile,
} from "@offeros/core";
import type { Db } from "../db/client";
import { listAnswers } from "../repositories/answer-repo";
import { getProfile } from "../repositories/profile-repo";
import { QUESTION_SOURCES, type QuestionSource } from "./question-sources";

/**
 * What forms ask, and whether the user can answer it. The one place that
 * decides.
 *
 * Sources say what was asked; this says what it means. Everything above —
 * the Requirements card, the answer-gaps list in the profile, the agent's read
 * tool — reads what comes out of here and never touches the database itself,
 * so how questions are stored can change without any of them noticing.
 *
 * Entirely deterministic. No model call anywhere in this file or below it: the
 * matching is the fill engine's own, so nothing here can promise a readiness
 * the fill will not deliver.
 */

/** Injectable for tests; production uses the registry. */
export interface CoverageDeps {
  sources?: QuestionSource[];
}

/**
 * Merge every sighting of one question into one row.
 *
 * Deduplicated by `questionKey`, which is stable across postings and
 * platforms — that is the whole reason it exists. `required` is true if ANY
 * sighting had it required: a question that is optional on one form and
 * mandatory on the next is a question worth having an answer to.
 *
 * A fill sighting outranks a prescan for the QUESTION TEXT, because a fill saw
 * the form as it is rather than as advertised. Counts take both.
 */
export function mergeObservations(observations: ObservedQuestion[]): Map<string, Merged> {
  const byKey = new Map<string, Merged>();
  for (const o of observations) {
    const existing = byKey.get(o.questionKey);
    if (!existing) {
      byKey.set(o.questionKey, {
        questionKey: o.questionKey,
        question: o.question,
        control: o.control,
        required: o.required,
        origins: new Set([o.origin]),
        vendors: new Set(o.vendor ? [o.vendor] : []),
        applications: new Set(o.applicationId ? [o.applicationId] : []),
        timesSeen: 1,
        unattributed: o.applicationId ? 0 : 1,
        preferredOrigin: o.origin,
      });
      continue;
    }
    existing.timesSeen += 1;
    existing.required = existing.required || o.required;
    existing.origins.add(o.origin);
    if (o.vendor) existing.vendors.add(o.vendor);
    if (o.applicationId) existing.applications.add(o.applicationId);
    else existing.unattributed += 1;
    // A fill's wording replaces a prescan's; a second fill does not replace the
    // first, so the text stays stable run to run.
    if (o.origin === "fill" && existing.preferredOrigin !== "fill") {
      existing.question = o.question;
      existing.control = o.control;
      existing.preferredOrigin = "fill";
    }
  }
  return byKey;
}

/**
 * Where we have both, believe the form we met.
 *
 * A prescan describes the form as the platform advertises it; a fill describes
 * the form as it actually was. Applied PER APPLICATION, which is the only scope
 * where the two describe the same thing: dropping every prescan sighting
 * globally would erase the questions from applications that were never filled,
 * which is most of what the gaps list is for.
 *
 * This is authority, not deduplication, so it lives here rather than in a
 * source — a source is not allowed to know what the other sources found.
 */
export function preferFills(observations: ObservedQuestion[]): ObservedQuestion[] {
  const filled = new Set(
    observations.filter((o) => o.origin === "fill" && o.applicationId).map((o) => o.applicationId),
  );
  return observations.filter(
    (o) => !(o.origin === "prescan" && o.applicationId && filled.has(o.applicationId)),
  );
}

interface Merged {
  questionKey: string;
  question: string;
  control: string;
  required: boolean;
  origins: Set<ObservedQuestion["origin"]>;
  vendors: Set<string>;
  applications: Set<string>;
  timesSeen: number;
  unattributed: number;
  preferredOrigin: ObservedQuestion["origin"];
}

/**
 * Does the user already have this answer?
 *
 * Two ways, both the fill engine's own: a saved answer whose patterns match the
 * question, or a profile field the classifier recognises and the profile
 * actually holds. Anything else is a gap — an optimistic guess here would be a
 * promise the fill cannot keep.
 */
export function isCovered(
  question: { question: string; control: string },
  answers: ReturnType<typeof listAnswers>,
  profile: Profile | null,
): boolean {
  if (matchAnswer(question.question, answers)) return true;
  const canonical = classifyField({
    fieldId: "",
    label: question.question,
    name: "",
    autocomplete: "",
    type: question.control,
    placeholder: "",
    ariaLabel: "",
  });
  if (!canonical || !profile) return false;
  const personal = profile.personal as unknown as Record<string, unknown>;
  const filled = (value: unknown) => typeof value === "string" && value.trim() !== "";
  switch (canonical) {
    case "firstName":
    case "lastName":
    case "fullName":
      return filled(personal.name);
    case "email":
      return filled(personal.email);
    case "phone":
      return filled(personal.phone);
    case "linkedin":
    case "github":
    case "portfolio": {
      const links = (personal.links ?? {}) as Record<string, unknown>;
      return filled(links[canonical]);
    }
    case "city":
    case "state":
    case "country":
    case "postalCode":
    case "address":
      return filled(personal[canonical]);
    case "resume":
      // Attaching is its own flow with its own card; not a gap this owns.
      return true;
    default:
      return false;
  }
}

/**
 * Every question in scope, with whether it is covered.
 *
 * THE read model. `buildRequirements` (one application) and `answerGaps`
 * (across all of them) are both views of this, so the two can never drift into
 * saying different things about the same question.
 */
export function buildCoverage(
  db: Db,
  scope: CoverageScope = {},
  deps: CoverageDeps = {},
): CoveredQuestion[] {
  const sources = deps.sources ?? QUESTION_SOURCES;
  const merged = mergeObservations(
    preferFills(sources.flatMap((source) => source.observe(db, scope))),
  );

  const answers = listAnswers(db);
  const profile = getProfile(db);

  return [...merged.values()].map((m): CoveredQuestion => {
    // Covered first, guard second, and the order matters.
    //
    // A guard stops OfferOS INVENTING an answer; it does not stop the user
    // storing one, and for the identity questions they mostly have — that is
    // what Profile → Equal Employment writes. Asking the guard first would have
    // reported a question they had answered as one nobody can answer, and
    // dropped it out of the readiness count on its way past.
    const covered = isCovered(m, answers, profile);
    const guard = covered ? null : guardClassOf({ label: m.question });
    const state = covered ? "answered" : guard ? "not-ours" : "unanswered";
    return {
      questionKey: m.questionKey,
      question: m.question,
      control: m.control,
      required: m.required,
      state,
      ...(guard ? { guard } : {}),
      seenOnApplications: m.applications.size,
      timesSeen: m.timesSeen,
      vendors: [...m.vendors].sort(),
      origins: [...m.origins].sort(),
    };
  });
}

/** How many gaps to hand back before a list stops being a to-do. */
export const GAPS_SHOWN = 20;

/**
 * The questions worth answering next, most-asked first.
 *
 * Ordered by how many of the user's own applications asked it, then by raw
 * sightings, then required before optional — the point of the list is "answer
 * this once and it stops costing you time", so what has actually cost the most
 * time goes first.
 */
export function answerGaps(
  db: Db,
  opts: { limit?: number } = {},
  deps: CoverageDeps = {},
): AnswerGaps {
  const limit = opts.limit ?? GAPS_SHOWN;
  const all = buildCoverage(db, {}, deps);

  const rank = (a: CoveredQuestion, b: CoveredQuestion) =>
    b.seenOnApplications - a.seenOnApplications ||
    b.timesSeen - a.timesSeen ||
    Number(b.required) - Number(a.required) ||
    a.question.localeCompare(b.question);

  const unanswered = all.filter((q) => q.state === "unanswered").sort(rank) as AnswerGap[];
  const notOurs = all.filter((q) => q.state === "not-ours").sort(rank) as AnswerGap[];

  return {
    gaps: unanswered.slice(0, limit),
    notOurs: notOurs.slice(0, limit),
    total: unanswered.length,
    // Sightings the sources could not pin to an application understate
    // `seenOnApplications`, and the UI says so rather than quietly rounding.
    hasUnattributedSightings: all.some((q) => q.timesSeen > 0 && q.seenOnApplications === 0),
  };
}
