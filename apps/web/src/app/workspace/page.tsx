import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { getDb } from "@/server/db/client";
import { listApplications } from "@/server/repositories/application-repo";

export const dynamic = "force-dynamic";

/**
 * "Workspace" nav entry: the agent workspace is per-application, so this route
 * jumps straight into the most recently updated active application (falling
 * back to the most recent one overall). With nothing to open it renders the
 * empty state that explains how a workspace comes to exist.
 */
export default function WorkspacePage() {
  const db = getDb();
  const applications = listApplications(db);
  const active = applications.filter((a) => a.status === "saved" || a.status === "applying");
  const target = active[0] ?? applications[0];
  if (target) redirect(`/applications/${target.id}`);

  return (
    <main className="mx-auto w-full max-w-[860px] px-6 py-10">
      <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
        <p className="text-title font-semibold">No agent workspace yet</p>
        <p className="mx-auto mt-1 max-w-[460px] text-body text-muted-foreground">
          Every application gets its own agent workspace — tailored résumé, JD analysis, cover
          letter, and the form-fill handoff. Add a job here, or use the extension&apos;s &ldquo;Add
          this job&rdquo; on a posting page.
        </p>
        <Link
          href="/applications/new"
          className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
        >
          <Plus className="size-4" strokeWidth={2.5} />
          New application
        </Link>
      </div>
    </main>
  );
}
