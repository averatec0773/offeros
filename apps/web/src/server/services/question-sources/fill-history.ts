import { questionKey as computeQuestionKey } from "@offeros/autofill";
import type { CoverageScope, ObservedQuestion } from "@offeros/core";
import type { Db } from "../../db/client";
import { listPipelineTasks } from "../../repositories/pipeline-task-repo";
import type { QuestionSource } from "./types";

/**
 * Questions we met by actually filling the form.
 *
 * The strongest source there is: the engine stood in front of the real form and
 * reported field by field. It is also the only one that can say WHICH
 * application a question was asked on, because the reports are stored per task
 * — which is what lets the gaps list say "asked on 4 of your applications"
 * rather than an unattributed tally.
 *
 * Reports written before question keys existed carry none. Rather than dropping
 * those questions — on this machine that would lose about a quarter of them —
 * the key is recomputed from the label with the same function the extension
 * uses, so an old sighting and a new one for the same question merge into one
 * row instead of appearing twice.
 */

/** A field the fill never attempted tells us nothing about what the form asks. */
const IGNORED_OUTCOMES = new Set(["skipped"]);

export const fillHistorySource: QuestionSource = {
  id: "fill",
  observe(db: Db, scope: CoverageScope): ObservedQuestion[] {
    const tasks = listPipelineTasks(db).filter((task) =>
      scope.applicationId ? task.applicationId === scope.applicationId : true,
    );

    const out: ObservedQuestion[] = [];
    for (const task of tasks) {
      for (const report of task.fieldReports ?? []) {
        if (IGNORED_OUTCOMES.has(report.outcome)) continue;
        const question = (report.label || "").trim();
        if (question === "") continue;
        out.push({
          questionKey: report.questionKey || keyFromLabel(question, report.classifiedType),
          question,
          control: report.classifiedType,
          required: report.required === true,
          origin: "fill",
          applicationId: task.applicationId,
          ...(task.updatedAt ? { at: task.updatedAt } : {}),
        });
      }
    }
    return out;
  },
};

/** The same identity the extension computes, from what an old report kept. */
function keyFromLabel(question: string, control: string): string {
  return computeQuestionKey(null, {
    fieldId: "",
    label: question,
    name: "",
    autocomplete: "",
    type: control,
    placeholder: "",
    ariaLabel: "",
  });
}
