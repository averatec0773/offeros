import type { JobInfo } from "@offeros/core";
import { MatchScoreRing } from "./match-score-ring";

function initials(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .split(/\s+/);
  const letters = words.slice(0, 2).map((w) => w[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-lg bg-muted px-2 py-1 text-caption font-medium text-muted-foreground">
      {children}
    </span>
  );
}

export function JobCard({ job }: { job: JobInfo }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-body font-semibold text-muted-foreground">
          {initials(job.companyName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-caption text-muted-foreground">
            {job.companyName}
            {job.publishTimeDesc ? (
              <>
                <span className="mx-1.5">·</span>
                {job.publishTimeDesc}
              </>
            ) : null}
          </div>
          <h3 className="mt-0.5 text-title font-semibold leading-snug text-foreground">
            {job.jobTitle}
          </h3>
        </div>
        {job.displayScore !== undefined ? <MatchScoreRing score={job.displayScore} /> : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {job.jobLocation && <Chip>{job.jobLocation}</Chip>}
        {job.employmentType && <Chip>{job.employmentType}</Chip>}
        {job.workModel && <Chip>{job.workModel}</Chip>}
        {job.jobSeniority && <Chip>{job.jobSeniority}</Chip>}
        {job.companyStage && <Chip>{job.companyStage}</Chip>}
        {job.salaryDesc && <Chip>{job.salaryDesc}</Chip>}
      </div>
    </div>
  );
}
