"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

export function JobComposer() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [applyLink, setApplyLink] = useState("");
  const [jdText, setJdText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = jdText.trim().length > 0 && companyName.trim().length > 0 && !pending;

  async function submit() {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const task = await api.pipelineTasks.createFromJd({
        jobInfo: {
          jobId: crypto.randomUUID(),
          jobTitle: jobTitle.trim() || "Untitled role",
          companyName: companyName.trim(),
          applyLink: applyLink.trim() || undefined,
        },
        jdText: jdText.trim(),
      });
      router.push(`/applications/${task.applicationId}`);
    } catch {
      setError("Couldn't create that application. Try again.");
      setPending(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h2 className="text-title font-semibold text-foreground">New application</h2>
      <p className="mt-1 text-body text-muted-foreground">
        Paste the job description and we&apos;ll tailor a résumé for it.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <input
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Company"
          className="rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <input
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="Job title"
          className="rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <input
          value={applyLink}
          onChange={(e) => setApplyLink(e.target.value)}
          placeholder="Posting URL (optional)"
          className="col-span-2 rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <textarea
        rows={8}
        value={jdText}
        onChange={(e) => setJdText(e.target.value)}
        placeholder="Paste the full job description here…"
        className="mt-2.5 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {error && <p className="mt-2 text-caption text-destructive">{error}</p>}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="inline-flex items-center rounded-full bg-primary px-4 py-2 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Start tailoring"}
        </button>
      </div>
    </div>
  );
}
