import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getApplication } from "@/server/repositories/application-repo";
import { getAgentTaskByApplicationId } from "@/server/repositories/agent-task-by-application";
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

  const task = getAgentTaskByApplicationId(db, id);
  const jdAnalysis = getJdAnalysis(db, id);
  const artifacts = task ? listArtifacts(db, task.id) : [];
  const fit = getFit(db, id);

  return (
    <WorkspaceClient
      application={application}
      initialTask={task}
      initialJdAnalysis={jdAnalysis}
      initialArtifacts={artifacts}
      initialFit={fit}
    />
  );
}
