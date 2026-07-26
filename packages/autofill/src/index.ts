export type {
  AnswerEntry,
  AnswerType,
  AnswerCategory,
  FillPersonalInfo,
  FillProfile,
} from "./types";

export type { NameParts } from "./format";
export { splitName, normalizeLink } from "./format";

export { geoCandidates } from "./geo-synonyms";

export type { SelectOption } from "./option-match";
export { flattenOptions, matchOption, matchOptionValue } from "./option-match";

export { pickSkillMatch, skillCandidates } from "./skill-match";

export { normalizeQuestion, matchAnswer } from "./answer-match";

export type { FieldDescriptor, CanonicalField } from "./classify";
export { classifyField } from "./classify";

export type { FillStatus, FillItem, Coverage, FieldTrace } from "./fill-plan";
export { buildFillPlan, classifiedRatio, fillCoverage, explainFillPlan } from "./fill-plan";
