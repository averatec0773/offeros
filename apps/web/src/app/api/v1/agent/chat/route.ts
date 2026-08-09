import { getDb } from "@/server/db/client";
import { getApplication } from "@/server/repositories/application-repo";
import { getAgentTaskByApplicationId } from "@/server/repositories/agent-task-by-application";
import { runTurn } from "@/server/agent/loop";
import { makeAgentLlm } from "@/server/agent/agent-llm";
import { handle, ok, badRequest, notFound } from "@/server/http/envelope";

export const runtime = "nodejs";

/**
 * One turn of the agent chat.
 *
 * Stateless by design: the client owns the transcript and sends the question,
 * the server answers it. There is no session to expire, nothing to clean up,
 * and a reload cannot leave a half-finished turn on the server. If a turn ever
 * needs to survive a reload, that is a table — not a change here.
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
    if (typeof applicationId !== "string" || applicationId.trim() === "") {
      return badRequest("applicationId is required");
    }

    const db = getDb();
    const application = getApplication(db, applicationId);
    if (!application) return notFound("application");
    const task = getAgentTaskByApplicationId(db, applicationId);

    const result = await runTurn({
      ctx: { db, applicationId, ...(task ? { taskId: task.id } : {}) },
      question: question.trim(),
      subject: `${application.jobInfo.jobTitle} at ${application.jobInfo.companyName}`,
      runLlm: makeAgentLlm(db),
    });
    return ok(result);
  });
}
