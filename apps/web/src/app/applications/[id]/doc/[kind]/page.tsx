import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getApplication } from "@/server/repositories/application-repo";
import { getPipelineTaskByApplicationId } from "@/server/repositories/pipeline-task-by-application";
import { getArtifact } from "@/server/repositories/artifact-repo";
import { listEvents } from "@/server/repositories/application-event-repo";
import { DocWorkbenchClient } from "@/components/agent/doc-workbench-client";

export const dynamic = "force-dynamic";

/**
 * The workbench for one generated document.
 *
 * A route rather than a panel on the application page: a document being worked
 * on wants the width, and a URL of its own means the back button and a link
 * both behave the way anyone would expect.
 */
export default async function DocWorkbenchPage({
  params,
}: {
  params: Promise<{ id: string; kind: string }>;
}) {
  const { id, kind } = await params;
  if (kind !== "resume" && kind !== "cover-letter") notFound();

  const db = getDb();
  const application = getApplication(db, id);
  if (!application) notFound();

  const task = getPipelineTaskByApplicationId(db, id);

  return (
    <DocWorkbenchClient
      application={application}
      kind={kind}
      taskId={task?.id ?? null}
      initialArtifact={task ? getArtifact(db, task.id, kind) : null}
      events={listEvents(db, id)}
    />
  );
}
