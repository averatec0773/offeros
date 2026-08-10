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
export { classifyField, isCoverLetterLabel } from "./classify";

export type { FillStatus, FillItem, Coverage, FieldTrace } from "./fill-plan";
export { buildFillPlan, classifiedRatio, fillCoverage, explainFillPlan } from "./fill-plan";

export type { GuardClass, GuardSubject } from "./guards";
export { guardClassOf, isAutoAnswerForbidden, needsPostFillReview } from "./guards";

export type { EvidenceItem, SelfAssessmentItem } from "./evidence-match";
export {
  scoreEvidence,
  selectEvidence,
  formatEvidence,
  matchSelfAssessment,
} from "./evidence-match";

export type { ApplicantConstraints, Conflict, ConflictKind } from "./constraints";
export { findConflicts } from "./constraints";

export type { FieldMeta, MetaControl, MetaSource, RawFieldMeta } from "./field-meta";
export { toControl, fromSemanticId, toFieldMeta, groupFieldMeta } from "./field-meta";

export type { FailureCause, CauseGroup, FillDiagnosis, DiagnosableField } from "./diagnose";
export { diagnoseFill } from "./diagnose";

export type { WizardState, WizardStep } from "./wizard";
export { readWizardState, canAdvance, describeWizard } from "./wizard";
