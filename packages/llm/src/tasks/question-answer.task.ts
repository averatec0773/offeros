import type { LlmTask } from "../task";

export interface QuestionAnswerInput {
  question: string;
  label: string;
  context?: string;
  profileSummary: string;
  jdText: string;
  resumeText: string;
  existingAnswer?: string;
}

export interface QuestionAnswerOutput {
  answer: string;
}

const DEFAULT_SYSTEM = [
  "You answer a single free-text application question on behalf of a job applicant, in first person, as if the applicant were writing it themselves.",
  "",
  "Answer the question directly and concisely — aim for 120 words or fewer unless the question itself demands more length (e.g. it explicitly asks for a detailed story or multiple examples).",
  "",
  "GROUNDING (hard constraint): ground every claim in the provided profile summary, resume, and job description. Never invent employers, dates, metrics, skills, or visa/relocation facts that are not present in the inputs. If the inputs do not contain the fact the question needs (e.g. availability, salary expectations), say so plainly in the answer rather than inventing it, so the applicant can edit it in.",
  "",
  "When an existing answer is given, treat it as a draft to improve — refine and ground it — not as something to contradict.",
  "",
  "Respond with the answer text only: plain text, no JSON, no markdown formatting, no headings or bullet scaffolding.",
].join("\n");

export const questionAnswerTask: LlmTask<QuestionAnswerInput, QuestionAnswerOutput> = {
  id: "question-answer",
  defaultSystemPrompt: DEFAULT_SYSTEM,
  maxTokens: 512,
  buildUserPrompt: (i) =>
    [
      `Question: "${i.question}"`,
      `Field label: "${i.label}"`,
      i.context ? `Context for this field: ${i.context}` : "",
      "",
      "Applicant profile summary:",
      i.profileSummary,
      "",
      "Resume:",
      "---",
      i.resumeText,
      "---",
      "",
      "Job description:",
      "---",
      i.jdText,
      "---",
      i.existingAnswer ? `\nExisting draft answer to improve:\n---\n${i.existingAnswer}\n---` : "",
    ]
      .filter((l) => l !== "")
      .join("\n"),
  parse: (raw) => ({ answer: raw.trim() }),
};
