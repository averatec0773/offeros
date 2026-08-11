import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getApplication, listApplications } from "@/server/repositories/application-repo";
import { getPipelineTaskByApplicationId } from "@/server/repositories/pipeline-task-by-application";
import { getJdAnalysis } from "@/server/repositories/jd-analysis-repo";
import { listArtifacts } from "@/server/repositories/artifact-repo";
import { getFit } from "@/server/repositories/fit-repo";
import { WorkspaceClient } from "@/components/agent/workspace-client";

export const dynamic = "force-dynamic";

export default async function ApplicationWorkspace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();
  const application = getApplication(db, id);
  if (!application) notFound();

  const task = getPipelineTaskByApplicationId(db, id);
  const jdAnalysis = getJdAnalysis(db, id);
  const artifacts = task ? listArtifacts(db, task.id) : [];
  const fit = getFit(db, id);
  // The status bar's queue popover: every application, newest first, the
  // open one flagged as current.
  const queue = listApplications(db)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 10)
    .map((a) => ({
      id: a.id,
      title: a.jobInfo.jobTitle,
      company: a.jobInfo.companyName,
      status: a.status,
      current: a.id === id,
    }));

  return (
    <WorkspaceClient
      application={application}
      initialTask={task}
      initialJdAnalysis={jdAnalysis}
      initialArtifacts={artifacts}
      initialFit={fit}
      queue={queue}
    />
  );
}
