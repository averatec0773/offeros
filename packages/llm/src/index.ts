export * from "./errors";
export * from "./task";
export * from "./models";
export * from "./run-task";
export * from "./registry";
export * from "./fake-provider";
export * from "./providers/types";
export { callProvider, callAnthropic, callOpenAI } from "./providers";
export * from "./tasks/resume-tailor.task";
export * from "./tasks/jd-analysis.task";
export { jdFactHints } from "./jd-fact-hints";
export * from "./tasks/cover-letter.task";
export * from "./tasks/question-answer.task";
export * from "./tasks/resume-parse.task";
export * from "./tasks/fit-analysis.task";
export * from "./tasks/style-distill.task";
export * from "./style-notes";
export * from "./untrusted";

// The agent loop parses the model's decision with the same tolerant reader the
// tasks use for their JSON payloads.
export { extractJson } from "./parse-json";
