export type TaskId =
  | "resume-tailor"
  | "jd-analysis"
  | "cover-letter"
  | "question-answer"
  | "resume-parse"
  | "fit-analysis";

export interface LlmTask<Input = unknown, Output = unknown> {
  id: TaskId;
  defaultSystemPrompt: string;
  buildUserPrompt: (input: Input) => string;
  schema?: Record<string, unknown>;
  parse: (raw: string) => Output;
  model?: string;
  maxTokens?: number;
}
