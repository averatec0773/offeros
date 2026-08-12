/**
 * Is this stored "job description" actually a job description?
 *
 * A capture that read a page's text with `textContent` swallowed the source of
 * every `<script>` on it, and on a component-framework page that is most of the
 * bytes. The result was stored, shown, and sent to a model as though the
 * employer had written it. The capture is fixed; the records it already made
 * are not, and nothing about them announces itself — a wall of minified
 * JavaScript looks, at a glance, like a wall of text.
 *
 * So this is the smoke alarm. It does not clean anything and it does not
 * decide anything: it lets the page put one line in front of the user offering
 * to fetch the posting again.
 *
 * Deliberately a pure function over a string, in `core`, because both the
 * server that stores the text and the page that renders it need the same
 * answer. Biased toward staying quiet: a job description that merely mentions
 * code must not be accused of being code, so every signal below is about the
 * DENSITY of syntax rather than its presence.
 */

/** Characters that carry meaning in code and almost none in prose. */
const SYNTAX_CHARS = /[;{}=<>()[\]]/g;

/** Constructs that essentially only appear in source. */
const CODE_PHRASES = [
  /\bfunction\s*\(/,
  /\bvar\s+[A-Za-z_$]/,
  /\blet\s+[A-Za-z_$]+\s*=/,
  /\bconst\s+[A-Za-z_$]+\s*=/,
  /=>\s*\{/,
  /\breturn\s+[A-Za-z_$'"[{]/,
  /\btypeof\s/,
  /\bdocument\.(getElementById|querySelector|createElement)/,
  /\bwindow\.[A-Za-z_$]/,
  /\$\(['"]/,
  /<\/?(script|style|div|span)\b/i,
];

/** Below this there is not enough text to judge, and a short description is a
 *  problem the user can already see. */
const MIN_CHARS_TO_JUDGE = 200;

/** Above this share of syntax characters, prose it is not. */
const SYNTAX_DENSITY_LIMIT = 0.04;

/** How many distinct code constructs are needed before density stops mattering. */
const CODE_PHRASE_LIMIT = 3;

export interface JdQuality {
  /** True when this reads like captured page source rather than a posting. */
  suspect: boolean;
  /** Share of characters that are code punctuation. Reported for the tests. */
  syntaxDensity: number;
  /** How many distinct code constructs were found. */
  codeSignals: number;
}

export function inspectJdText(text: string | null | undefined): JdQuality {
  const t = typeof text === "string" ? text : "";
  if (t.length < MIN_CHARS_TO_JUDGE) {
    return { suspect: false, syntaxDensity: 0, codeSignals: 0 };
  }
  const syntaxDensity = (t.match(SYNTAX_CHARS)?.length ?? 0) / t.length;
  const codeSignals = CODE_PHRASES.filter((re) => re.test(t)).length;
  // Either signal alone can be innocent — a description full of parentheses, or
  // one that quotes a single line of code in a "what you'll build" section. The
  // pair together is what a captured script looks like.
  const suspect =
    (syntaxDensity > SYNTAX_DENSITY_LIMIT && codeSignals >= 1) || codeSignals >= CODE_PHRASE_LIMIT;
  return { suspect, syntaxDensity, codeSignals };
}

/** True when the stored description reads like page source. */
export function looksLikeCapturedCode(text: string | null | undefined): boolean {
  return inspectJdText(text).suspect;
}

/** The one line the page puts in front of the user. Named so both ends match. */
export const SUSPECT_JD_NOTICE =
  "This description looks like page code rather than the posting — re-fetch it, or paste the text yourself.";
