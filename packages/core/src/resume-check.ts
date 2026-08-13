import type { ResumeHeader } from "./resume";
import type { StructuredResume } from "./resume";

/**
 * A résumé checkup that costs nothing and always says the same thing twice.
 *
 * Every rule below is a pure function of the résumé. No model call, no network,
 * no judgement about whether the work described is any good — these are the
 * conventions a recruiter's eye applies in the first ten seconds, and the point
 * is to catch the ones that are embarrassing to miss and tedious to check by
 * hand.
 *
 * It lives in `packages/core` rather than `packages/autofill` because it is
 * about the résumé, and the résumé is core's own domain object. `autofill`
 * knows about form controls and label text and has no business knowing what a
 * bullet point should look like.
 *
 * Deliberately NOT here: anything requiring taste. "Your summary is weak",
 * "these bullets lack impact", "quantify your achievements" — a rule cannot
 * know those, and a checklist that pretends to is worse than no checklist,
 * because a person will try to satisfy it. Every rule states a fact about the
 * document and lets the reader decide what it means.
 */

/** What a rule is given. */
export interface ResumeCheckInput {
  /** The structured résumé, when there is one. */
  resume: StructuredResume;
  /** The rendered text, for rules about wording rather than structure. */
  text: string;
  /** Contact details, which live on the profile rather than in the document. */
  header?: ResumeHeader;
}

/** One thing a rule looked at. */
export interface ResumeFinding {
  ruleId: string;
  /** True when nothing needs doing. */
  ok: boolean;
  /** The check, as a short phrase: "Length", "Dates", "First person". */
  title: string;
  /** What was found, in one sentence, and what it means if it is not ok. */
  detail: string;
  /** Where to look, when the rule can be specific. */
  where?: string;
}

export interface ResumeRule {
  id: string;
  title: string;
  /** One or more findings. An empty array means the rule had nothing to say —
   *  a rule that cannot run on this résumé stays silent rather than passing. */
  run(input: ResumeCheckInput): ResumeFinding[];
}

const words = (text: string): string[] => text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));

const finding = (rule: ResumeRule, ok: boolean, detail: string, where?: string): ResumeFinding => ({
  ruleId: rule.id,
  ok,
  title: rule.title,
  detail,
  ...(where ? { where } : {}),
});

/**
 * A résumé that is too short says nothing and one that is too long is not read.
 *
 * The bounds are wide on purpose — this catches a document that is obviously
 * wrong, not one that is a hundred words off someone's preference.
 */
const MIN_WORDS = 200;
const MAX_WORDS = 1000;

const lengthRule: ResumeRule = {
  id: "length",
  title: "Length",
  run({ text }) {
    const count = words(text).length;
    if (count === 0) return [];
    if (count < MIN_WORDS) {
      return [
        finding(
          lengthRule,
          false,
          `${count} words. Under ${MIN_WORDS} usually means an experience or a section is missing rather than that you have been concise.`,
        ),
      ];
    }
    if (count > MAX_WORDS) {
      return [
        finding(
          lengthRule,
          false,
          `${count} words. Over ${MAX_WORDS} runs past two pages for most layouts, and the last page is the one nobody reads.`,
        ),
      ];
    }
    return [finding(lengthRule, true, `${count} words.`)];
  },
};

const sectionsRule: ResumeRule = {
  id: "sections",
  title: "Sections",
  run({ resume }) {
    // Nothing parsed at all — an uploaded PDF we hold only as text, say. That
    // is not a résumé with no experience, it is a résumé we cannot see the
    // shape of, and "no work experience" would be a false accusation that
    // teaches the reader to distrust the whole list.
    const empty =
      resume.experience.length === 0 &&
      resume.education.length === 0 &&
      resume.skills.length === 0 &&
      resume.summary.trim() === "";
    if (empty) return [];
    const missing: string[] = [];
    if (resume.experience.length === 0) missing.push("work experience");
    if (resume.education.length === 0) missing.push("education");
    if (resume.skills.length === 0) missing.push("skills");
    return [
      missing.length === 0
        ? finding(sectionsRule, true, "Experience, education and skills are all present.")
        : finding(
            sectionsRule,
            false,
            `No ${missing.join(" and no ")}. Most screens filter on these before a person sees the document.`,
          ),
    ];
  },
};

/** Below this an entry looks unfinished; above it, nobody reads to the end. */
const MIN_BULLETS = 2;
const MAX_BULLETS = 8;

const bulletCountRule: ResumeRule = {
  id: "bullet-count",
  title: "Bullets per role",
  run({ resume }) {
    const out: ResumeFinding[] = [];
    for (const job of resume.experience) {
      const bullets = job.bullets.filter((b) => b.trim() !== "");
      const where = [job.title, job.company].filter(Boolean).join(" · ") || "an experience entry";
      if (bullets.length < MIN_BULLETS) {
        out.push(
          finding(
            bulletCountRule,
            false,
            `${bullets.length === 0 ? "No bullets" : "One bullet"} — a role with less than ${MIN_BULLETS} reads as a placeholder.`,
            where,
          ),
        );
      } else if (bullets.length > MAX_BULLETS) {
        out.push(
          finding(
            bulletCountRule,
            false,
            `${bullets.length} bullets. Past ${MAX_BULLETS} the strongest ones stop standing out.`,
            where,
          ),
        );
      }
    }
    return out.length > 0
      ? out
      : resume.experience.length > 0
        ? [finding(bulletCountRule, true, `Every role has ${MIN_BULLETS}–${MAX_BULLETS} bullets.`)]
        : [];
  },
};

/** A bullet longer than this is a paragraph wearing a bullet's clothes. */
const MAX_BULLET_WORDS = 45;

const bulletLengthRule: ResumeRule = {
  id: "bullet-length",
  title: "Bullet length",
  run({ resume }) {
    const long: string[] = [];
    for (const job of resume.experience) {
      for (const bullet of job.bullets) {
        if (words(bullet).length > MAX_BULLET_WORDS) {
          long.push(bullet.trim().slice(0, 60) + "…");
        }
      }
    }
    if (long.length === 0) {
      return resume.experience.length > 0
        ? [finding(bulletLengthRule, true, `No bullet runs past ${MAX_BULLET_WORDS} words.`)]
        : [];
    }
    return [
      finding(
        bulletLengthRule,
        false,
        `${long.length} bullet${long.length === 1 ? "" : "s"} over ${MAX_BULLET_WORDS} words. At that length it is read as a paragraph and skipped.`,
        long[0],
      ),
    ];
  },
};

/**
 * "I built", "my team" — the résumé convention is to leave the subject out.
 *
 * Only counted at the start of a bullet or after a sentence break, so a
 * bullet that quotes someone, or mentions "AI" or a product with "I" in it, is
 * not flagged for it.
 */
const firstPersonRule: ResumeRule = {
  id: "first-person",
  title: "First person",
  run({ resume }) {
    const pattern = /(^|[.;]\s+)(i|my|me|we|our)\b/i;
    const hits = resume.experience
      .flatMap((job) => job.bullets)
      .filter((bullet) => pattern.test(bullet.trim()));
    if (hits.length === 0) {
      return [finding(firstPersonRule, true, "No first-person pronouns at the start of a bullet.")];
    }
    return [
      finding(
        firstPersonRule,
        false,
        `${hits.length} bullet${hits.length === 1 ? "" : "s"} begin with I/my/we. Résumés conventionally drop the subject — "Built X" rather than "I built X".`,
        hits[0]!.trim().slice(0, 60),
      ),
    ];
  },
};

/**
 * Bullets that mostly end with a full stop, and some that do not.
 *
 * Either convention is fine; mixing them is what looks careless, so this only
 * fires when there is a clear majority and a clear minority.
 */
const punctuationRule: ResumeRule = {
  id: "punctuation",
  title: "Punctuation",
  run({ resume }) {
    const bullets = resume.experience
      .flatMap((job) => job.bullets)
      .map((b) => b.trim())
      .filter((b) => b !== "");
    if (bullets.length < 3) return [];
    const withStop = bullets.filter((b) => /[.!?]$/.test(b)).length;
    const without = bullets.length - withStop;
    if (withStop === 0 || without === 0) {
      return [finding(punctuationRule, true, "Bullets end consistently.")];
    }
    const minority = Math.min(withStop, without);
    return [
      finding(
        punctuationRule,
        false,
        `${withStop} bullets end with a full stop and ${without} do not. Either is fine; the mix is what reads as unfinished.`,
        `${minority} to change`,
      ),
    ];
  },
};

/**
 * Past roles in the past tense, and one convention throughout.
 *
 * Only the obvious case: a bullet that starts with a present-tense verb in a
 * role whose dates have ended. Tense is genuinely hard, so this looks at the
 * one pattern that is reliably wrong rather than guessing at the rest.
 */
const tenseRule: ResumeRule = {
  id: "tense",
  title: "Tense",
  run({ resume }) {
    const present = /^(manage|lead|build|develop|design|own|run|write|create|maintain|support)\b/i;
    const ended = resume.experience.filter((job) => !/present|current|now/i.test(job.dates));
    const hits = ended.flatMap((job) =>
      job.bullets.filter((b) => present.test(b.trim())).map((b) => ({ job, bullet: b })),
    );
    if (ended.length === 0) return [];
    if (hits.length === 0) {
      return [finding(tenseRule, true, "Finished roles are described in the past tense.")];
    }
    const first = hits[0]!;
    return [
      finding(
        tenseRule,
        false,
        `${hits.length} bullet${hits.length === 1 ? "" : "s"} in a finished role start with a present-tense verb.`,
        [first.job.title, first.job.company].filter(Boolean).join(" · ") ||
          first.bullet.slice(0, 40),
      ),
    ];
  },
};

/** One date format, used everywhere. */
const datesRule: ResumeRule = {
  id: "dates",
  title: "Dates",
  run({ resume }) {
    const shapes = new Set<string>();
    const all = [...resume.experience, ...resume.education]
      .map((e) => e.dates.trim())
      .filter((d) => d !== "");
    for (const dates of all) {
      if (/\b\d{4}\s*[-–—]\s*(\d{4}|present|current)/i.test(dates)) shapes.add("2019 – 2022");
      else if (/[a-z]{3,}\.?\s+\d{4}/i.test(dates)) shapes.add("March 2019");
      else if (/\b\d{1,2}\/\d{4}/.test(dates)) shapes.add("03/2019");
      else if (/\b\d{4}-\d{2}/.test(dates)) shapes.add("2019-03");
      else shapes.add(dates);
    }
    if (all.length < 2) return [];
    if (shapes.size <= 1) return [finding(datesRule, true, "Dates are written the same way.")];
    return [
      finding(
        datesRule,
        false,
        `${shapes.size} different date formats. One format throughout reads as one document.`,
        [...shapes].slice(0, 3).join(", "),
      ),
    ];
  },
};

/** A résumé nobody can reply to. */
const contactRule: ResumeRule = {
  id: "contact",
  title: "Contact details",
  run({ header }) {
    if (!header) return [];
    const missing: string[] = [];
    if (!header.name?.trim()) missing.push("name");
    if (!header.email?.trim()) missing.push("email");
    if (!header.phone?.trim()) missing.push("phone");
    return [
      missing.length === 0
        ? finding(contactRule, true, "Name, email and phone are all present.")
        : finding(contactRule, false, `No ${missing.join(", no ")}.`),
    ];
  },
};

/**
 * The registry. Adding a check is an entry here and nothing else.
 *
 * The engine below does not know what any rule does, and no consumer knows
 * which rules exist — they render whatever findings come back. Same rule the
 * question sources and the PDF renderers are held to.
 */
export const RESUME_RULES: ResumeRule[] = [
  lengthRule,
  sectionsRule,
  contactRule,
  bulletCountRule,
  bulletLengthRule,
  firstPersonRule,
  punctuationRule,
  tenseRule,
  datesRule,
];

/** Run every rule. Failures first — those are what the reader came for. */
export function checkResume(
  input: ResumeCheckInput,
  rules: ResumeRule[] = RESUME_RULES,
): ResumeFinding[] {
  const findings = rules.flatMap((rule) => rule.run(input));
  return [...findings].sort((a, b) => Number(a.ok) - Number(b.ok));
}
