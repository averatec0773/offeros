import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getDb } from "@/server/db/client";
import { listApplications } from "@/server/repositories/application-repo";
import { listAgentTasks } from "@/server/repositories/agent-task-repo";
import { newestTaskByApplication } from "@/server/repositories/agent-task-by-application";
import { listCampaigns } from "@/server/repositories/campaign-repo";
import { campaignProgress, describeProgress } from "@/server/services/campaign-service";
import { NewCampaignButton } from "@/components/agent/campaign-actions";

export const dynamic = "force-dynamic";

/**
 * All campaigns, each with the one line that matters: how far through the
 * batch it is. Creating happens here or from a selection on the applications
 * list — both land in the same place.
 */
export default function CampaignsPage() {
  const db = getDb();
  const campaigns = listCampaigns(db);
  const applications = listApplications(db);
  const taskByApplication = newestTaskByApplication(listAgentTasks(db));

  const active = campaigns.filter((campaign) => campaign.status === "active");
  const archived = campaigns.filter((campaign) => campaign.status === "archived");

  return (
    <main className="mx-auto w-full max-w-[860px] px-6 py-10">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-heading font-semibold">Campaigns</h1>
          <span className="text-body text-muted-foreground">
            Batches of applications you work through together
          </span>
        </div>
        <NewCampaignButton />
      </header>

      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <p className="text-title font-semibold">No campaigns yet</p>
          <p className="mx-auto mt-1 max-w-[460px] text-body text-muted-foreground">
            Create one here, or select applications on the Applications page and move them into a
            new campaign — a campaign is just a named batch, and running it uses the same queue and
            the same gates as running anything else.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            {active.map((campaign) => {
              const progress = campaignProgress(campaign.id, applications, taskByApplication);
              return (
                <Link
                  key={campaign.id}
                  href={`/campaigns/${campaign.id}`}
                  className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 transition hover:opacity-80"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-title font-semibold">{campaign.name}</span>
                    <span className="block truncate text-body text-muted-foreground">
                      {describeProgress(progress)}
                      {campaign.note ? ` · ${campaign.note}` : ""}
                    </span>
                  </span>
                  {progress.needsYou > 0 && (
                    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-warn-bg px-3 py-1 text-caption font-semibold">
                      <span className="size-1.5 rounded-full bg-warn" />
                      {progress.needsYou} need you
                    </span>
                  )}
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              );
            })}
          </section>

          {archived.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-body font-semibold text-muted-foreground">Archived</h2>
              {archived.map((campaign) => {
                const progress = campaignProgress(campaign.id, applications, taskByApplication);
                return (
                  <Link
                    key={campaign.id}
                    href={`/campaigns/${campaign.id}`}
                    className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 opacity-70 transition hover:opacity-90"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-title font-semibold">
                        {campaign.name}
                      </span>
                      <span className="block truncate text-body text-muted-foreground">
                        {describeProgress(progress)}
                      </span>
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                );
              })}
            </section>
          )}
        </div>
      )}
    </main>
  );
}
