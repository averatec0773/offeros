import type { LlmTask, TaskId } from "./task";
import { resumeTailorTask } from "./tasks/resume-tailor.task";
import { jdAnalysisTask } from "./tasks/jd-analysis.task";
import { coverLetterTask } from "./tasks/cover-letter.task";
import { questionAnswerTask } from "./tasks/question-answer.task";
import { resumeParseTask } from "./tasks/resume-parse.task";
import { fitAnalysisTask } from "./tasks/fit-analysis.task";
import { styleDistillTask } from "./tasks/style-distill.task";
import { fieldAnalyzeTask } from "./tasks/field-analyze.task";

export const TASKS: Record<TaskId, LlmTask> = {
  "resume-tailor": resumeTailorTask as LlmTask,
  "jd-analysis": jdAnalysisTask as LlmTask,
  "cover-letter": coverLetterTask as LlmTask,
  "question-answer": questionAnswerTask as LlmTask,
  "resume-parse": resumeParseTask as LlmTask,
  "fit-analysis": fitAnalysisTask as LlmTask,
  "style-distill": styleDistillTask as LlmTask,
  "field-analyze": fieldAnalyzeTask as LlmTask,
};

export function getTask(id: string): LlmTask | null {
  return (TASKS as Record<string, LlmTask | undefined>)[id] ?? null;
}
