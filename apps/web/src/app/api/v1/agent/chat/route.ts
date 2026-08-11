import { getDb } from "@/server/db/client";
import { getApplication, listApplications } from "@/server/repositories/application-repo";
import { getPipelineTaskByApplicationId } from "@/server/repositories/pipeline-task-by-application";
import {
  appendChatMessage,
  listRecentMessages,
  GLOBAL_SCOPE,
} from "@/server/repositories/chat-repo";
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
 * Conversations are THREADS now, persisted server-side (chat_messages): one
 * per application plus one global, shared by every chat surface. Each request
 * still stands alone — the server loads the thread's recent window, answers,
 * appends both sides, and holds nothing in memory between requests, so a
 * reload cannot leave a half-finished turn behind. History resolves
 * references ("the second one"); facts are still re-read through tools.
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
      const task = getPipelineTaskByApplicationId(db, id);
      return { applicationId: id, ...(task ? { taskId: task.id } : {}) };
    };

    /** Answer within a thread: load the window, run the turn, append both
     *  sides. The user message is persisted BEFORE the model runs — a failed
     *  turn should still show what was asked. */
    const answerInThread = async (
      scope: string,
      turn: Omit<Parameters<typeof runTurn>[0], "history" | "runLlm">,
    ) => {
      // BOTH sides are TRUNCATED into the window on purpose, for two different
      // reasons.
      //
      // Assistant turns: reproduced live — after several similar questions the
      // model imitated the shape of its own earlier answers over the current
      // answer rules, losing better data and better instructions to precedent.
      // A 200-char snippet keeps the referents ("the second one", "that job")
      // that history exists for, without carrying enough prose to imitate.
      //
      // User turns: a pasted job description is a legitimate question, and at
      // several KB it would ride along in EVERY later turn of the thread —
      // ten of those is the whole context window spent on text the tools can
      // re-read from the database anyway. 500 chars is well past what a
      // referent needs ("that Stripe one", "the second job I asked about").
      // The CURRENT question is never truncated; it is passed in full below
      // and only enters the window on the turn after it.
      const history = listRecentMessages(db, scope, 10).map((m) => ({
        role: m.role,
        content: m.content.slice(0, m.role === "assistant" ? 200 : 500),
      }));
      appendChatMessage(db, { scope, role: "user", content: question.trim() });
      const result = await runTurn({ ...turn, history, runLlm: makeAgentLlm(db) });
      appendChatMessage(db, {
        scope,
        role: "assistant",
        content: result.answer,
        steps: result.steps,
        ranOutOfSteps: result.ranOutOfSteps,
      });
      return result;
    };

    if (applicationId) {
      const application = getApplication(db, applicationId);
      if (!application) return notFound("application");
      const result = await answerInThread(applicationId, {
        ctx: { db, ...focus(applicationId)! },
        question: question.trim(),
        subject: `${application.jobInfo.jobTitle} at ${application.jobInfo.companyName}`,
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
    const result = await answerInThread(GLOBAL_SCOPE, {
      ctx: { db, ...focus(newest.id)! },
      question: question.trim(),
      focus,
    });
    return ok(result);
  });
}
