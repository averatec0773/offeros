import Link from "next/link";
import { Plus } from "lucide-react";
import { getDb } from "@/server/db/client";
import { listApplications } from "@/server/repositories/application-repo";
import { listPipelineTasks } from "@/server/repositories/pipeline-task-repo";
import { newestTaskByApplication } from "@/server/repositories/pipeline-task-by-application";
import { getProfile } from "@/server/repositories/profile-repo";
import { listFits } from "@/server/repositories/fit-repo";
import { AddJobDialog } from "@/components/agent/add-job-dialog";
import { ApplicationList } from "@/components/agent/application-list";
import { QueueBar } from "@/components/agent/queue-bar";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const db = getDb();
  const applications = listApplications(db);
  const tasks = listPipelineTasks(db);
  const fits = listFits(db);
  const hasProfile = getProfile(db) !== null;
  const taskByApplication = newestTaskByApplication(tasks);
  const fitByApplication = new Map(fits.map((fit) => [fit.applicationId, fit]));

  const active = applications.filter((a) => a.status === "saved" || a.status === "applying");
  const finished = applications.filter((a) => a.status !== "saved" && a.status !== "applying");
  const toRow = (application: (typeof applications)[number]) => ({
    application,
    task: taskByApplication.get(application.id) ?? null,
    fit: fitByApplication.get(application.id) ?? null,
  });

  return (
    <main className="mx-auto w-full max-w-[1120px] px-6 py-10">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-heading font-semibold">Applications</h1>
          <span className="text-body text-muted-foreground">
            {applications.length} total · {active.length} active
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AddJobDialog />
          <Link
            href="/applications/new"
            className="text-caption font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Paste a description instead
          </Link>
        </div>
      </header>

      {applications.length > 0 && (
        <QueueBar
          eligible={active
            .filter((a) => taskByApplication.get(a.id)?.status !== "done")
            .map((a) => a.id)}
          jobs={active.map((a) => ({
            id: a.id,
            title: a.jobInfo.jobTitle,
            company: a.jobInfo.companyName,
            status: a.status,
          }))}
        />
      )}

      {applications.length === 0 ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
            <p className="text-title font-semibold">No applications yet</p>
            <p className="mx-auto mt-1 max-w-[460px] text-body text-muted-foreground">
              Add a job to get started — each one opens its own agent workspace with a tailored
              résumé, JD analysis, and form-fill handoff.
            </p>
            <Link
              href="/applications/new"
              className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-body font-semibold text-primary-foreground press hover:bg-primary/85"
            >
              <Plus className="size-4" strokeWidth={2.5} />
              New application
            </Link>
          </div>
          {!hasProfile && (
            <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center">
              <p className="text-title font-semibold">Set up your profile first</p>
              <p className="mx-auto mt-1 max-w-[420px] text-body text-muted-foreground">
                Upload your résumé once and OfferOS tailors it and autofills applications for you.
              </p>
              <Link
                href="/profile"
                className="mt-4 inline-flex items-center rounded-full bg-primary px-4 py-2 text-body font-semibold text-primary-foreground press hover:bg-primary/85"
              >
                Set up your profile
              </Link>
            </div>
          )}
        </div>
      ) : (
        <ApplicationList active={active.map(toRow)} finished={finished.map(toRow)} />
      )}
    </main>
  );
}
