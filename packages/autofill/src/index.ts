export type {
  AnswerEntry,
  AnswerType,
  AnswerCategory,
  FillPersonalInfo,
  FillProfile,
  FillEducation,
  FillExperience,
} from "./types";

export type { NameParts } from "./format";
export { splitName, normalizeLink } from "./format";

export { geoCandidates } from "./geo-synonyms";

export type { SelectOption } from "./option-match";
export { flattenOptions, matchOption, matchOptionValue } from "./option-match";

export { pickSkillMatch, skillCandidates } from "./skill-match";

export { normalizeQuestion, matchAnswer } from "./answer-match";

export {
  isGenericName,
  isTransientText,
  isUsableLabel,
  looksLikeHumanLabel,
  looksLikeCaptcha,
  looksLikeIdentifier,
  CAPTCHA_REASON,
} from "./label-quality";

export type { HistoryKind, HistoryField, RowFieldMatch } from "./history-rows";
export {
  assignHistoryRows,
  matchHistoryField,
  totalExperienceYears,
  valueForRow,
} from "./history-rows";

export type { FieldDescriptor, CanonicalField } from "./classify";
export { classifyField, isCoverLetterLabel } from "./classify";

export type { FillStatus, FillItem, Coverage, FieldTrace } from "./fill-plan";
export {
  buildFillPlan,
  classifiedRatio,
  fillCoverage,
  explainFillPlan,
  personalValue,
} from "./fill-plan";

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

export type { FillStats, CauseCount, AtsBreakdown, ApplicationFill } from "./fill-stats";
export { computeFillStats, atsFromUrl } from "./fill-stats";

export { fnv1a64, questionKey, formFingerprint, newQuestions } from "./fingerprint";

export type { TriggerId, TriggerField, TriggerInput, Incident } from "./triggers";
export { detectIncidents, requiredCoverage, isPreventableFailure } from "./triggers";

export type { ReplayRow, ReplayDivergence } from "./replay";
export { replayForm, diffReplays } from "./replay";

export type { CaptureFinding } from "./capture-audit";
export { auditCapturedForm, verifyCaptureRoundTrip } from "./capture-audit";

export type { CanaryPersona, ProvenanceLeak, ProvenanceReport } from "./canary";
export { canaryPersonas, profileAtoms, distinctiveAtoms, checkProvenance } from "./canary";

export type { PageValueState, PageValueInput } from "./placeholder";
export {
  isPlaceholderText,
  isPlaceholderPhone,
  isPlaceholderValue,
  valuesAgree,
  pageValueState,
} from "./placeholder";
