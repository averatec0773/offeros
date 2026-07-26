import Link from "next/link";
import { Plus } from "lucide-react";
import { getDb } from "@/server/db/client";
import { listApplications } from "@/server/repositories/application-repo";
import { listAgentTasks } from "@/server/repositories/agent-task-repo";
import { getProfile } from "@/server/repositories/profile-repo";
import { listFits } from "@/server/repositories/fit-repo";
import { ApplicationRow } from "@/components/agent/application-row";
import { EmptyState } from "@/components/empty-state";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const db = getDb();
  const applications = listApplications(db);
  const tasks = listAgentTasks(db);
  const fits = listFits(db);
  const hasProfile = getProfile(db) !== null;
  const taskByApplication = new Map(tasks.map((task) => [task.applicationId, task]));
  const fitByApplication = new Map(fits.map((fit) => [fit.applicationId, fit]));

  const active = applications.filter((a) => a.status === "saved" || a.status === "applying");
  const finished = applications.filter((a) => a.status !== "saved" && a.status !== "applying");

  return (
    <main className="mx-auto w-full max-w-[860px] px-6 py-10">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-heading font-semibold">Applications</h1>
          <span className="text-body text-muted-foreground">
            {applications.length} total · {active.length} active
          </span>
        </div>
        <Link
          href="/applications/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
        >
          <Plus className="size-4" strokeWidth={2.5} />
          New application
        </Link>
      </header>

      {applications.length === 0 ? (
        <div className="space-y-4">
          <EmptyState
            title="No applications yet"
            body="Add a job to get started — paste a posting URL or import your existing data."
          />
          {!hasProfile && (
            <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
              <p className="text-title font-semibold">Set up your profile first</p>
              <p className="mx-auto mt-1 max-w-[420px] text-body text-muted-foreground">
                Upload your résumé once and OfferOS tailors it and autofills applications for you.
              </p>
              <Link
                href="/profile"
                className="mt-4 inline-flex items-center rounded-full bg-primary px-4 py-2 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
              >
                Set up your profile
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-body font-semibold text-muted-foreground">In progress</h2>
            {active.length === 0 ? (
              <EmptyState title="Nothing in progress" body="Every application has moved on." />
            ) : (
              active.map((application) => (
                <ApplicationRow
                  key={application.id}
                  application={application}
                  task={taskByApplication.get(application.id) ?? null}
                  fit={fitByApplication.get(application.id) ?? null}
                />
              ))
            )}
          </section>

          {finished.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-body font-semibold text-muted-foreground">Finished</h2>
              {finished.map((application) => (
                <ApplicationRow
                  key={application.id}
                  application={application}
                  task={taskByApplication.get(application.id) ?? null}
                  fit={fitByApplication.get(application.id) ?? null}
                />
              ))}
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}
