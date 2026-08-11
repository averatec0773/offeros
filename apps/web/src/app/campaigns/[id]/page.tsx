import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/server/db/client";
import { listApplications } from "@/server/repositories/application-repo";
import { listPipelineTasks } from "@/server/repositories/pipeline-task-repo";
import { newestTaskByApplication } from "@/server/repositories/pipeline-task-by-application";
import { listFits } from "@/server/repositories/fit-repo";
import { getCampaign } from "@/server/repositories/campaign-repo";
import { campaignProgress, describeProgress } from "@/server/services/campaign-service";
import { ApplicationRow } from "@/components/agent/application-row";
import { QueueBar } from "@/components/agent/queue-bar";
import { CampaignHeaderActions } from "@/components/agent/campaign-actions";

export const dynamic = "force-dynamic";

/**
 * One campaign: its members, and a run bar scoped to them.
 *
 * The run bar is the SAME QueueBar the homepage uses, fed the campaign's
 * member ids — a campaign never gets its own execution machinery, so every
 * gate the queue enforces (dealbreakers, human gates, already-done) holds here
 * automatically. Rows are the same rows as the applications list; membership
 * management (moving in and out) stays on that list's selection mode rather
 * than being duplicated here.
 */
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const campaign = getCampaign(db, id);
  if (!campaign) notFound();

  const applications = listApplications(db);
  const taskByApplication = newestTaskByApplication(listPipelineTasks(db));
  const fitByApplication = new Map(listFits(db).map((fit) => [fit.applicationId, fit]));

  const members = applications.filter((application) => application.campaignId === campaign.id);
  const progress = campaignProgress(campaign.id, applications, taskByApplication);
  const eligible = members
    .filter((a) => a.status === "saved" || a.status === "applying")
    .filter((a) => taskByApplication.get(a.id)?.status !== "done")
    .map((a) => a.id);

  return (
    <main className="mx-auto w-full max-w-[860px] px-6 py-10">
      <Link
        href="/campaigns"
        className="mb-4 inline-flex items-center gap-1.5 text-caption font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        All campaigns
      </Link>

      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-heading font-semibold">{campaign.name}</h1>
          <span className="text-body text-muted-foreground">
            {describeProgress(progress)}
            {campaign.status === "archived" ? " · archived" : ""}
          </span>
          {campaign.note && <p className="mt-1 text-body text-muted-foreground">{campaign.note}</p>}
        </div>
        <CampaignHeaderActions campaign={campaign} />
      </header>

      {members.length > 0 && (
        <QueueBar
          eligible={eligible}
          jobs={members
            .filter((a) => a.status === "saved" || a.status === "applying")
            .map((a) => ({
              id: a.id,
              title: a.jobInfo.jobTitle,
              company: a.jobInfo.companyName,
              status: a.status,
            }))}
        />
      )}

      {members.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <p className="text-title font-semibold">Nothing in this campaign yet</p>
          <p className="mx-auto mt-1 max-w-[460px] text-body text-muted-foreground">
            Go to Applications, hit Select, pick the jobs for this batch and move them here.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex items-center rounded-full bg-primary px-4 py-2 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
          >
            Open Applications
          </Link>
        </div>
      ) : (
        <section className="space-y-3">
          {members.map((application) => (
            <ApplicationRow
              key={application.id}
              application={application}
              task={taskByApplication.get(application.id) ?? null}
              fit={fitByApplication.get(application.id) ?? null}
            />
          ))}
        </section>
      )}
    </main>
  );
}
