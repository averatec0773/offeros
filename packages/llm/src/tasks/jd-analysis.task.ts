import type { JobInfo } from "@offeros/core";
import { z } from "zod";
import { extractJson } from "../parse-json";
import type { LlmTask } from "../task";

export const COVER_LETTER_REQUIREMENTS = ["unknown", "none", "optional", "required"] as const;
export type CoverLetterRequirement = (typeof COVER_LETTER_REQUIREMENTS)[number];

export interface JdAnalysisInput {
  jdText: string;
  jobInfo: JobInfo;
  profileSummary: string;
}

export interface JdAnalysisOutput {
  summary: string;
  responsibilities: string[];
  requiredSkills: string[];
  preferredSkills: string[];
  matchNotes: string[];
  gaps: string[];
  coverLetterRequirement: CoverLetterRequirement;
}

const strArr = { type: "array", items: { type: "string" } } as const;

const JD_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "responsibilities",
    "requiredSkills",
    "preferredSkills",
    "matchNotes",
    "gaps",
    "coverLetterRequirement",
  ],
  properties: {
    summary: { type: "string" },
    responsibilities: strArr,
    requiredSkills: strArr,
    preferredSkills: strArr,
    matchNotes: strArr,
    gaps: strArr,
    coverLetterRequirement: { type: "string", enum: [...COVER_LETTER_REQUIREMENTS] },
  },
} as const;

const jdAnalysisSchema = z.object({
  summary: z.string(),
  responsibilities: z.array(z.string()),
  requiredSkills: z.array(z.string()),
  preferredSkills: z.array(z.string()),
  matchNotes: z.array(z.string()),
  gaps: z.array(z.string()),
  coverLetterRequirement: z.enum(COVER_LETTER_REQUIREMENTS),
});

const DEFAULT_SYSTEM = [
  "You analyze a job description for an applicant.",
  "Derive everything only from the job description and the applicant profile summary provided.",
  "Do not invent requirements, skills, or responsibilities the JD does not state.",
  "responsibilities = the core duties the JD describes.",
  "requiredSkills / preferredSkills = split by how the JD phrases each requirement (must-have vs nice-to-have).",
  "matchNotes = specific, concrete ways the applicant's profile already meets the JD, grounded in the profile summary.",
  "gaps = things the JD asks for that the profile summary does not show — frame as areas to address, not a verdict.",
  "coverLetterRequirement: infer from explicit JD cues.",
  '  - "required" if the JD explicitly asks for a cover letter,',
  '  - "none" if the application process explicitly says none is needed or accepted,',
  '  - "optional" as the default when the JD gives no explicit cue either way,',
  '  - "unknown" only if the JD text is too sparse to judge at all.',
  "Leave a field empty (empty string or empty array) rather than guessing.",
  "Respond with JSON only, matching the given schema.",
].join(" ");

export const jdAnalysisTask: LlmTask<JdAnalysisInput, JdAnalysisOutput> = {
  id: "jd-analysis",
  defaultSystemPrompt: DEFAULT_SYSTEM,
  maxTokens: 1500,
  schema: JD_ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
  buildUserPrompt: (i) =>
    [
      `Role: "${i.jobInfo.jobTitle ?? ""}" at "${i.jobInfo.companyName ?? ""}".`,
      "",
      "Applicant profile summary (the only source of truth for matchNotes/gaps):",
      i.profileSummary,
      "",
      "Job description:",
      "---",
      i.jdText,
      "---",
    ].join("\n"),
  parse: (raw) => {
    const value = extractJson(raw);
    const parsed = jdAnalysisSchema.safeParse(value);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  },
};
