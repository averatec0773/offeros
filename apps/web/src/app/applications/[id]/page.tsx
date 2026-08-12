import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getApplication } from "@/server/repositories/application-repo";
import { getPipelineTaskByApplicationId } from "@/server/repositories/pipeline-task-by-application";
import { listArtifacts } from "@/server/repositories/artifact-repo";
import { listEvents } from "@/server/repositories/application-event-repo";
import { listIncidents } from "@/server/repositories/form-memory-repo";
import { getFit } from "@/server/repositories/fit-repo";
import { getJdAnalysis } from "@/server/repositories/jd-analysis-repo";
import { getProfile } from "@/server/repositories/profile-repo";
import { buildRequirements } from "@/server/services/requirements-service";
import { ApplicationDetailClient } from "@/components/agent/application-detail-client";

export const dynamic = "force-dynamic";

/** One application's record. Everything it shows is read here, on the server,
 *  so the page is complete on first paint rather than assembling itself. */
export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();
  const application = getApplication(db, id);
  if (!application) notFound();

  const task = getPipelineTaskByApplicationId(db, id);

  return (
    <ApplicationDetailClient
      application={application}
      initialTask={task}
      initialArtifacts={task ? listArtifacts(db, task.id) : []}
      initialFit={getFit(db, id)}
      initialEvents={listEvents(db, id)}
      initialRequirements={buildRequirements(db, id)!}
      initialIncidents={listIncidents(db, id)}
      initialJdAnalysis={getJdAnalysis(db, id)}
      profileSkills={getProfile(db)?.skills ?? []}
    />
  );
}
