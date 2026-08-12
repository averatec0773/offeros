import { pickSkillMatch, skillCandidates } from "@offeros/autofill";

/**
 * Marking up a job description with what the applicant already has.
 *
 * This costs nothing and runs on every render. That is the point: the same
 * question ("which of these do I actually have?") is elsewhere a feature you
 * pay for or upload a résumé to unlock, and here it is a string search over a
 * profile the user already gave us.
 *
 * The MATCHING is not reimplemented — every "is this skill that skill"
 * decision goes through `@offeros/autofill`'s `pickSkillMatch`/`skillCandidates`,
 * the same pair the fit card's gaps come from. This module only decides where
 * in the text the matched terms sit. One algorithm, two presentations; they
 * cannot disagree.
 */

export type SegmentKind = "plain" | "have" | "missing";

export interface JdSegment {
  text: string;
  kind: SegmentKind;
}

/** Characters that may legitimately end a skill token ("C++", "C#", ".NET"),
 *  so a boundary check does not cut them in half. */
const WORDISH = /[A-Za-z0-9+#.]/;

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ALNUM = /[A-Za-z0-9]/;

/**
 * Is the match at `index` a whole term rather than a fragment?
 *
 * Plain `\b` is wrong here: it treats "+" and "#" as boundaries, so "C" would
 * match inside "C++" and every mention of C++ would light up as C.
 *
 * The dot needs its own rule, because it does two jobs. In ".NET" and
 * "Node.js" it is part of the name; in "We need Go." it ends the sentence.
 * So a dot only continues a word when a letter or digit follows it — without
 * that distinction every skill at the end of a sentence goes unhighlighted,
 * which is exactly what the tests caught.
 */
function continuesWord(text: string, at: number, direction: 1 | -1): boolean {
  const char = text[at];
  if (!char || !WORDISH.test(char)) return false;
  if (char !== ".") return true;
  const beyond = text[at + direction];
  return !!beyond && ALNUM.test(beyond);
}

function isWholeTerm(text: string, index: number, length: number): boolean {
  return !continuesWord(text, index - 1, -1) && !continuesWord(text, index + length, 1);
}

/**
 * Which of the applicant's own skills are named in this job description.
 *
 * Returns the PROFILE's spelling, not the JD's, so the chips read as the
 * user's own vocabulary. Aliases count: a profile listing "k8s" matches a JD
 * saying "Kubernetes", because `skillCandidates` says they are the same thing.
 */
export function profileSkillsInJd(jdText: string, profileSkills: string[]): string[] {
  if (!jdText.trim()) return [];
  const found: string[] = [];
  for (const skill of profileSkills) {
    const terms = skillCandidates(skill).filter((t) => t.trim() !== "");
    const hit = terms.some((term) => findTerm(jdText, term) !== -1);
    if (hit && !found.includes(skill)) found.push(skill);
  }
  return found;
}

/** First whole-term occurrence of `term` in `text`, case-insensitive. */
function findTerm(text: string, term: string): number {
  const re = new RegExp(escapeRegExp(term), "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (isWholeTerm(text, match.index, match[0].length)) return match.index;
    // Zero-length guard: a pathological term must not spin here.
    if (match.index === re.lastIndex) re.lastIndex++;
  }
  return -1;
}

/**
 * Split the description into runs of plain text and runs to highlight.
 *
 * `have` wins ties with `missing`: a term the applicant demonstrably has is
 * never shown as a gap, whatever the analysis said. Overlapping matches keep
 * the longest, so "Machine Learning" is one highlight rather than two.
 */
export function segmentJd(
  jdText: string,
  have: readonly string[],
  missing: readonly string[],
): JdSegment[] {
  if (!jdText) return [];
  const marks: { start: number; end: number; kind: SegmentKind }[] = [];

  const collect = (skills: readonly string[], kind: SegmentKind) => {
    for (const skill of skills) {
      for (const term of skillCandidates(skill)) {
        if (term.trim() === "") continue;
        const re = new RegExp(escapeRegExp(term), "gi");
        let match: RegExpExecArray | null;
        while ((match = re.exec(jdText)) !== null) {
          if (isWholeTerm(jdText, match.index, match[0].length)) {
            marks.push({ start: match.index, end: match.index + match[0].length, kind });
          }
          if (match.index === re.lastIndex) re.lastIndex++;
        }
      }
    }
  };
  collect(have, "have");
  collect(missing, "missing");

  // Longest first, then "have" ahead of "missing" at the same span, so the
  // winner of an overlap is deterministic rather than input-order dependent.
  marks.sort(
    (a, b) =>
      a.start - b.start ||
      b.end - b.start - (a.end - a.start) ||
      (a.kind === "have" ? -1 : 1) - (b.kind === "have" ? -1 : 1),
  );

  const segments: JdSegment[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue; // swallowed by a longer neighbour
    if (mark.start > cursor) {
      segments.push({ text: jdText.slice(cursor, mark.start), kind: "plain" });
    }
    segments.push({ text: jdText.slice(mark.start, mark.end), kind: mark.kind });
    cursor = mark.end;
  }
  if (cursor < jdText.length) {
    segments.push({ text: jdText.slice(cursor), kind: "plain" });
  }
  return segments;
}

/**
 * The skills a job description asks for that the applicant does not have.
 *
 * Deliberately derived from the stored analysis rather than guessed from the
 * text: knowing a term appears is not knowing it is *required*. With no
 * analysis yet, this is empty — the zero-cost layer highlights what it can
 * prove and stays quiet about the rest.
 */
export function missingFromAnalysis(
  analysisGaps: readonly string[],
  profileSkills: readonly string[],
): string[] {
  const candidates = profileSkills.flatMap((s) => skillCandidates(s));
  return analysisGaps.filter(
    (gap) => gap.trim() !== "" && pickSkillMatch(candidates, skillCandidates(gap)) === null,
  );
}
