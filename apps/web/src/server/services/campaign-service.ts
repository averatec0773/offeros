import type { AgentTask, Application } from "@offeros/core";

/**
 * Where a campaign stands, counted from its members.
 *
 * Pure arithmetic over data the pages already load — deliberately NOT a SQL
 * aggregate, because "needs you" comes from the task's Action-Required
 * contract, which lives inside the task document, and the pages that show this
 * have already loaded the tasks for their rows anyway. One source, one load.
 */
export interface CampaignProgress {
  members: number;
  /** Applications still moving: saved or applying. */
  inProgress: number;
  /** Tasks parked on the user (Action Required). */
  needsYou: number;
  submitted: number;
}

export function campaignProgress(
  campaignId: string,
  applications: Application[],
  taskByApplication: ReadonlyMap<string, AgentTask>,
): CampaignProgress {
  const members = applications.filter((application) => application.campaignId === campaignId);
  return {
    members: members.length,
    inProgress: members.filter((a) => a.status === "saved" || a.status === "applying").length,
    needsYou: members.filter((a) => taskByApplication.get(a.id)?.applicationInfo?.status === 2)
      .length,
    submitted: members.filter(
      (a) => a.status === "applied" || a.status === "interview" || a.status === "offer",
    ).length,
  };
}

/** The one-line summary a campaign row shows. */
export function describeProgress(progress: CampaignProgress): string {
  if (progress.members === 0) return "Empty — add applications from the Applications page";
  const parts = [`${progress.submitted}/${progress.members} submitted`];
  if (progress.needsYou > 0) parts.push(`${progress.needsYou} need you`);
  else if (progress.inProgress > 0) parts.push(`${progress.inProgress} in progress`);
  return parts.join(" · ");
}
