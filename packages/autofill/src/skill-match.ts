// Verified matching of a resume skill against the options an ATS typeahead
// renders. Unlike the naive "click the first suggestion" approach, this only
// accepts an option whose text actually corresponds to the skill — so skill
// "C" never gets tagged as "C++", and a wrong suggestion is skipped rather than
// silently committed.

// Keep +, #, . so "C++", "C#", ".NET" stay distinct; drop other punctuation.
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#.]/g, "");
}

// Strip a trailing parenthetical qualifier ("JavaScript (Programming Language)").
function stripQualifier(s: string): string {
  return s.replace(/\s*\([^)]*\)\s*$/, "");
}

function matches(candidate: string, option: string): boolean {
  const c = norm(candidate);
  if (c === "") return false;
  return c === norm(option) || c === norm(stripQualifier(option));
}

/**
 * The first option that exactly matches any candidate (normalized, tolerant of a
 * parenthetical qualifier), or null when none does. Candidates are tried in
 * order, so callers can pass [skill, ...synonyms] for taxonomy-miss fallback.
 */
export function pickSkillMatch(
  candidates: string[],
  optionTexts: string[],
): { index: number; text: string } | null {
  for (const candidate of candidates) {
    const index = optionTexts.findIndex((opt) => matches(candidate, opt));
    if (index !== -1) return { index, text: optionTexts[index]! };
  }
  return null;
}

// Small, extensible alias map for common abbreviations that strict-taxonomy ATSs
// (Workday) would otherwise drop. The original skill always comes first.
const ALIASES: Record<string, string[]> = {
  js: ["JavaScript"],
  ts: ["TypeScript"],
  py: ["Python"],
  golang: ["Go"],
  k8s: ["Kubernetes"],
  ml: ["Machine Learning"],
  nlp: ["Natural Language Processing"],
};

export function skillCandidates(skill: string): string[] {
  const alias = ALIASES[skill.trim().toLowerCase()];
  return alias ? [skill, ...alias] : [skill];
}
