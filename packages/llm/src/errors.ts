export const ANTHROPIC_MODEL = "claude-opus-4-8";
export const OPENAI_MODEL = "gpt-4o";

export type LlmErrorKind =
  "no_key" | "http" | "bad_output" | "unsupported_provider" | "unknown_task";

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
