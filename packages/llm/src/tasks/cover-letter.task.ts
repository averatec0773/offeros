import type { JobInfo } from "@offeros/core";
import { z } from "zod";
import { extractJson } from "../parse-json";
import type { LlmTask } from "../task";

export interface CoverLetterInput {
  jobInfo: JobInfo;
  groundingFacts: string;
  jdSummary?: string;
  instruction?: string;
  previousContent?: string;
  /** scaffoldHints from the user's default cover-letter template, when one exists. */
  templateHints?: string;
}

export interface CoverLetterOutput {
  content: string;
  rationale: string;
}

const coverLetterSchema = z.object({
  content: z.string(),
  rationale: z.string(),
});

const COVER_LETTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["content", "rationale"],
  properties: {
    content: { type: "string" },
    rationale: { type: "string" },
  },
} as const;

// Encodes the applicant's real letter anatomy (learned from their actual
// application workspace) rather than a generic "write a cover letter" prompt.
const DEFAULT_SYSTEM = [
  "You write the full text of a cover letter for a job application, in one pass, ready to send.",
  "",
  "STRUCTURE (fixed — do not deviate):",
  "1. A header block with the applicant's name and contact details, taken from groundingFacts.",
  '2. The salutation, written exactly as: "Dear Hiring Team," — never a named recipient, even if a hiring manager\'s name appears in the facts.',
  "3. EXACTLY three body paragraphs. No bullet lists, no headings inside the body.",
  "   - Paragraph 1 (hook, 2–3 sentences): the applicant's core credential plus a specific, concrete reason this company/role is a fit — tied to something actually stated in the job description, not a generic compliment.",
  "   - Paragraph 2 (deepest proof-point): the single strongest, most relevant accomplishment from groundingFacts, engineered in detail — what was built, led, or solved, and the result.",
  '   - Paragraph 3 (second proof-point + close): a second proof-point plus complementary experience, closing with a company-specific line in the form "I\'d be excited to bring <X> to <team/company>."',
  '4. The closing, written exactly as: "Thank you for your time and consideration." followed by "Sincerely, <applicant name>" on its own line.',
  "",
  "The header, salutation, and closing are fixed scaffolding — their wording and position stay constant across every draft; only the three body paragraphs change between drafts.",
  "",
  "LENGTH & TONE: about 300–320 words total, one page, dense and professional — no filler, no throat-clearing, no clichés.",
  "",
  "GROUNDING (hard constraint): use ONLY facts present in groundingFacts. Never invent metrics, skills, employers, titles, or projects that are not there. If a detail would strengthen a paragraph but is not in groundingFacts, omit it rather than inventing it.",
  "",
  "REVISION: when an instruction is given alongside previousContent, apply the instruction to produce the next version of the letter. Applying an instruction can legitimately mean re-selecting which proof-points from groundingFacts to foreground in paragraphs 2–3 — not just rephrasing the existing text.",
  "",
  'Respond with JSON only: { "content": string, "rationale": string }, where `content` is the complete letter text (header through signature) and `rationale` is one sentence summarizing what the letter emphasizes.',
].join("\n");

export const coverLetterTask: LlmTask<CoverLetterInput, CoverLetterOutput> = {
  id: "cover-letter",
  defaultSystemPrompt: DEFAULT_SYSTEM,
  maxTokens: 2048,
  schema: COVER_LETTER_SCHEMA as unknown as Record<string, unknown>,
  buildUserPrompt: (i) =>
    [
      `Role: "${i.jobInfo.jobTitle ?? ""}" at "${i.jobInfo.companyName ?? ""}".`,
      i.templateHints ? `User template constraints:\n${i.templateHints}` : "",
      "",
      "Grounding facts (the only source of truth for claims):",
      i.groundingFacts,
      "",
      i.jdSummary ? `Job description summary:\n${i.jdSummary}` : "",
      i.previousContent ? `Previous letter draft:\n---\n${i.previousContent}\n---` : "",
      i.instruction ? `Instruction for this revision: ${i.instruction}` : "",
    ]
      .filter((l) => l !== "")
      .join("\n\n"),
  parse: (raw) => {
    const value = extractJson(raw);
    const parsed = coverLetterSchema.safeParse(value);
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  },
};
