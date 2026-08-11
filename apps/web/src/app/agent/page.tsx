import { getDb } from "@/server/db/client";
import { listApplications } from "@/server/repositories/application-repo";
import { listPipelineTasks } from "@/server/repositories/pipeline-task-repo";
import { newestTaskByApplication } from "@/server/repositories/pipeline-task-by-application";
import { listRecentTrace } from "@/server/repositories/agent-trace-repo";
import { buildInbox } from "@/server/services/attention-service";
import { computeFillStats } from "@offeros/autofill";
import { FillQuality } from "@/components/agent/fill-quality";
import { FormMemoryCard } from "@/components/agent/form-memory-card";
import { formMemorySummary } from "@/server/repositories/form-memory-repo";
import { DashboardPeek } from "@/components/agent/dashboard-peek";
import { ConsolePeek } from "@/components/agent/console-peek";
import { AgentChat } from "@/components/agent/agent-chat";

export const dynamic = "force-dynamic";

/**
 * The agent page IS the conversation — a full-height chat, the page itself
 * fixed to the viewport so only the message list scrolls. Everything else that
 * used to stack under the chat (the run queue, the "needs you" inbox, the
 * activity trace, the fill analytics) folds into two header chips — Console and
 * Dashboard — one click away, never in the way. Per-application detail stays in
 * the workspace.
 */
export default function AgentConsolePage() {
  const db = getDb();
  const applications = listApplications(db);
  const tasks = listPipelineTasks(db);
  const taskByApplication = newestTaskByApplication(tasks);
  const active = applications.filter((a) => a.status === "saved" || a.status === "applying");
  const stats = computeFillStats(
    applications.map((a) => ({
      applyLink: a.jobInfo.applyLink,
      fields: taskByApplication.get(a.id)?.fieldReports ?? [],
    })),
  );
  const memory = formMemorySummary(db);

  return (
    // Fixed to the viewport minus the 4rem (h-16) top nav, so the page never
    // scrolls; the chat's own message list takes the slack.
    <main className="mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-[1120px] flex-col gap-4 px-6 py-6">
      <header className="flex shrink-0 items-center justify-between gap-4">
        <div>
          <h1 className="text-heading font-semibold">Agent</h1>
          <span className="text-caption text-muted-foreground">
            {active.length} in progress · {applications.length} tracked
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ConsolePeek
            eligible={active
              .filter((a) => taskByApplication.get(a.id)?.status !== "done")
              .map((a) => a.id)}
            jobs={active.map((a) => ({
              id: a.id,
              title: a.jobInfo.jobTitle,
              company: a.jobInfo.companyName,
              status: a.status,
            }))}
            initialInbox={buildInbox(db)}
            initialTrace={listRecentTrace(db, 40)}
          />
          <DashboardPeek line={`${stats.coverage}% fill · ${memory.knownQuestions} questions`}>
            <FillQuality stats={stats} />
            <FormMemoryCard memory={memory} fills={stats.applications} />
          </DashboardPeek>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        <AgentChat fill />
      </div>
    </main>
  );
}
