import { getDb } from "@/server/db/client";
import { listApplications } from "@/server/repositories/application-repo";
import { listAgentTasks } from "@/server/repositories/agent-task-repo";
import { listRecentTrace } from "@/server/repositories/agent-trace-repo";
import { buildInbox } from "@/server/services/attention-service";
import { ConsoleClient } from "@/components/agent/console-client";

export const dynamic = "force-dynamic";

/** The agent console: the run queue, everything waiting on the user across all
 *  applications, and what the agent has been doing. Per-application detail
 *  stays in the workspace, one click away. */
export default function AgentConsolePage() {
  const db = getDb();
  const applications = listApplications(db);
  const tasks = listAgentTasks(db);
  const taskByApplication = new Map(tasks.map((t) => [t.applicationId, t]));
  const active = applications.filter((a) => a.status === "saved" || a.status === "applying");

  return (
    <main className="mx-auto w-full max-w-[860px] px-6 py-10">
      <header className="mb-8">
        <h1 className="text-heading font-semibold">Agent</h1>
        <span className="text-body text-muted-foreground">
          {active.length} in progress · {applications.length} tracked
        </span>
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
