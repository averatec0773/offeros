import { getDb } from "@/server/db/client";
import { getApplication, listApplications } from "@/server/repositories/application-repo";
import { getAgentTaskByApplicationId } from "@/server/repositories/agent-task-by-application";
import { runTurn } from "@/server/agent/loop";
import { makeAgentLlm } from "@/server/agent/agent-llm";
import { handle, ok, badRequest, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

/**
 * One turn of the agent chat.
 *
 * `applicationId` is optional, and its absence is the difference between the
 * two conversations this serves. With it, the agent is pinned to one job and
 * never asks which. Without it — the campaign console — it can move between
 * jobs, and `focus` is how: the loop re-scopes each call to whichever
 * application the agent named, so the trace records the work against the job it
 * was actually about.
 *
 * Stateless by design: the client owns the transcript and sends the question,
 * the server answers it. There is no session to expire, nothing to clean up,
 * and a reload cannot leave a half-finished turn on the server.
 *
 * The answer comes back with the steps the agent took, because the steps are
 * the evidence. An answer about someone's job applications that cannot be
 * traced to what was read is worth less than no answer.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body: unknown = await request.json().catch(() => null);
    const question = (body as { question?: unknown } | null)?.question;
    const applicationId = (body as { applicationId?: unknown } | null)?.applicationId;
    if (typeof question !== "string" || question.trim() === "") {
      return badRequest("question is required");
    }
    if (applicationId !== undefined && typeof applicationId !== "string") {
      return badRequest("applicationId must be a string when present");
    }

    const db = getDb();
    /** Resolve an id the agent named, with its newest task. Unknown ids return
     *  null so the loop can tell the agent rather than throwing. */
    const focus = (id: string) => {
      if (!getApplication(db, id)) return null;
      const task = getAgentTaskByApplicationId(db, id);
      return { applicationId: id, ...(task ? { taskId: task.id } : {}) };
    };

    if (applicationId) {
      const application = getApplication(db, applicationId);
      if (!application) return notFound("application");
      const result = await runTurn({
        ctx: { db, ...focus(applicationId)! },
        question: question.trim(),
        subject: `${application.jobInfo.jobTitle} at ${application.jobInfo.companyName}`,
        runLlm: makeAgentLlm(db),
      });
      return ok(result);
    }

    // Campaign scope. The context needs SOME application id — every tool call
    // is recorded against one — so it starts on the newest and moves as the
    // agent names others. A user with no applications gets a plain answer
    // rather than an error: "nothing to talk about yet" is the truth.
    const applications = listApplications(db);
    const newest = applications[0];
    if (!newest) {
      return ok({
        answer: "You have not added any applications yet. Add a job and I can help with it.",
        steps: [],
        ranOutOfSteps: false,
      });
    }
    const result = await runTurn({
      ctx: { db, ...focus(newest.id)! },
      question: question.trim(),
      focus,
      runLlm: makeAgentLlm(db),
    });
    return ok(result);
  });
}
