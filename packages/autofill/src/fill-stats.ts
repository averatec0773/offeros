import { diagnoseFill, type DiagnosableField, type FailureCause } from "./diagnose";

/**
 * How well the fill engine is actually doing, across every application.
 *
 * The reason this exists is that "is it getting better" has so far been a
 * feeling, and a feeling is the last thing to notice a regression. Every number
 * here comes from field reports the engine already writes; nothing is estimated
 * and nothing needs a model.
 *
 * The headline is deliberately NOT "fields filled ÷ fields seen". That figure
 * counts a guard refusing to answer a demographic question, and a file only a
 * person can upload, as failures — so the fastest way to raise it would be to
 * weaken the guards, which is the worst possible thing to optimise for. The
 * headline is coverage of the fields the engine could reasonably have filled,
 * and the rest is shown beside it rather than folded in.
 */

export interface CauseCount {
  cause: FailureCause;
  fields: number;
  /** How many of them the form marks required — urgent versus tidy-up. */
  required: number;
}

export interface AtsBreakdown {
  /** A display label derived from the apply link, e.g. "Greenhouse". */
  ats: string;
  applications: number;
  expected: number;
  filled: number;
}

export interface FillStats {
  /** Applications that have run a fill at least once. */
  applications: number;
  /** Every field the engine has seen across those fills. */
  fields: number;
  filled: number;
  /** Controls the engine judged not to be questions — never failures. */
  skipped: number;
  /**
   * Fields the engine could reasonably have filled: everything except the ones
   * a guard refused and the ones only a person can upload. The denominator of
   * the honest number.
   */
  expected: number;
  /** filled ÷ expected, 0–100, rounded. The number worth watching. */
  coverage: number;
  causes: CauseCount[];
  byAts: AtsBreakdown[];
}

/** Causes that are the system working, not failing. Excluded from `expected`
 *  so improving the score can never mean weakening a guard. */
const NOT_A_FAILURE: FailureCause[] = ["only-you-can-answer", "manual-upload"];

/**
 * A readable platform name from an apply link.
 *
 * Display only — the extension has its own matcher for deciding whether a page
 * is supported, and that one must stay authoritative. An unrecognised host is
 * reported as "Other" rather than as its raw domain: a dashboard row per
 * employer careers site would bury the rows that matter.
 */
export function atsFromUrl(url: string | undefined): string {
  if (!url) return "Other";
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "Other";
  }
  if (host.includes("greenhouse")) return "Greenhouse";
  if (host.includes("lever.co")) return "Lever";
  if (host.includes("ashbyhq")) return "Ashby";
  if (host.includes("myworkdayjobs")) return "Workday";
  if (host.includes("icims")) return "iCIMS";
  return "Other";
}

export interface ApplicationFill {
  applyLink?: string;
  fields: DiagnosableField[];
}

export function computeFillStats(applications: ApplicationFill[]): FillStats {
  const withFills = applications.filter((a) => a.fields.length > 0);
  const causeTotals = new Map<FailureCause, { fields: number; required: number }>();
  const atsTotals = new Map<string, AtsBreakdown>();
  let fields = 0;
  let filled = 0;
  let skipped = 0;
  let notFailures = 0;

  for (const application of withFills) {
    const diagnosis = diagnoseFill(application.fields);
    fields += diagnosis.total;
    filled += diagnosis.filled;
    skipped += diagnosis.skipped;

    let applicationNotFailures = 0;
    for (const group of diagnosis.causes) {
      const running = causeTotals.get(group.cause) ?? { fields: 0, required: 0 };
      causeTotals.set(group.cause, {
        fields: running.fields + group.count,
        required: running.required + group.requiredCount,
      });
      if (NOT_A_FAILURE.includes(group.cause)) applicationNotFailures += group.count;
    }
    notFailures += applicationNotFailures;

    const ats = atsFromUrl(application.applyLink);
    const row = atsTotals.get(ats) ?? { ats, applications: 0, expected: 0, filled: 0 };
    row.applications += 1;
    row.filled += diagnosis.filled;
    row.expected += diagnosis.total - diagnosis.skipped - applicationNotFailures;
    atsTotals.set(ats, row);
  }

  const expected = fields - skipped - notFailures;
  return {
    applications: withFills.length,
    fields,
    filled,
    skipped,
    expected,
    coverage: expected > 0 ? Math.round((filled / expected) * 100) : 0,
    causes: [...causeTotals.entries()]
      .map(([cause, v]) => ({ cause, fields: v.fields, required: v.required }))
      .sort((a, b) => b.fields - a.fields),
    byAts: [...atsTotals.values()].sort((a, b) => b.expected - a.expected),
  };
}
