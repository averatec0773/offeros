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
import { ConsoleClient } from "@/components/agent/console-client";

export const dynamic = "force-dynamic";

/** The agent console: the run queue, everything waiting on the user across all
 *  applications, and what the agent has been doing. Per-application detail
 *  stays in the workspace, one click away. */
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
    <main className="mx-auto w-full max-w-[860px] px-6 py-10">
      {/* The chat is what this page is FOR, so the analytics fold into a chip
          up here — one line, click for the full cards. */}
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-heading font-semibold">Agent</h1>
          <span className="text-body text-muted-foreground">
            {active.length} in progress · {applications.length} tracked
          </span>
        </div>
        <DashboardPeek
          line={`${stats.coverage}% fill · ${memory.knownQuestions} questions · ${memory.totalIncidents} incidents`}
        >
          <FillQuality stats={stats} />
          <FormMemoryCard memory={memory} fills={stats.applications} />
        </DashboardPeek>
      </header>

      <ConsoleClient
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
    </main>
  );
}
