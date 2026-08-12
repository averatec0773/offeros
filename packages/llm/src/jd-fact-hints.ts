/**
 * A free, deterministic look at a posting before the model reads it.
 *
 * The point is narrow: tell the analysis which of the four facts have
 * candidate text at all, so a salary printed in the second line does not come
 * back as "not mentioned". It decides nothing — every verdict is still the
 * model's, and a hint that finds nothing simply says nothing.
 *
 * Regex, not a model: this runs on text the user already has, costs no token,
 * and would be absurd to pay for.
 */

const PATTERNS: [key: string, re: RegExp][] = [
  // A currency amount, or an explicit pay word near a number.
  [
    "salary",
    /(?:[$£€]\s?\d[\d,.]*\s?(?:k\b|per|\/|-|–)?)|(?:\b(?:salary|compensation|pay|base)\b[^.\n]{0,40}\d)/i,
  ],
  [
    "sponsorship",
    /\b(?:sponsor(?:ship|ing)?|h-?1b|work (?:authorization|authorisation|visa)|visa)\b/i,
  ],
  ["remote", /\b(?:remote|hybrid|on-?site|in-?person|work from home|wfh)\b/i],
  ["deadline", /\b(?:deadline|apply by|applications? close|closing date|last date)\b/i],
];

/**
 * One line naming the facts the posting appears to mention, for the prompt.
 * Empty string when it mentions none of them — nothing worth saying.
 */
export function jdFactHints(jdText: string): string {
  if (!jdText.trim()) return "";
  const found = PATTERNS.filter(([, re]) => re.test(jdText)).map(([key]) => key);
  if (found.length === 0) return "";
  return `the posting appears to mention ${found.join(", ")} — read those carefully before deciding a state`;
}
