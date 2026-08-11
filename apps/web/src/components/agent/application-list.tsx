import type { PipelineTask, Application, FitAnalysis } from "@offeros/core";
import { ApplicationRow } from "./application-row";
import { EmptyState } from "@/components/empty-state";

export type ApplicationListRow = {
  application: Application;
  task: PipelineTask | null;
  fit: FitAnalysis | null;
};

/** The applications list: what is still moving, and what has finished. */
export function ApplicationList({
  active,
  finished,
}: {
  active: ApplicationListRow[];
  finished: ApplicationListRow[];
}) {
  const rowProps = (row: ApplicationListRow) => ({
    application: row.application,
    task: row.task,
    fit: row.fit,
  });

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-body font-semibold text-muted-foreground">In progress</h2>
        {active.length === 0 ? (
          <EmptyState title="Nothing in progress" body="Every application has moved on." />
        ) : (
          active.map((row) => <ApplicationRow key={row.application.id} {...rowProps(row)} />)
        )}
      </section>

      {finished.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-body font-semibold text-muted-foreground">Finished</h2>
          {finished.map((row) => (
            <ApplicationRow key={row.application.id} {...rowProps(row)} />
          ))}
        </section>
      )}
    </div>
  );
}
