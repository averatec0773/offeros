import { useState } from "react";
import { Button } from "../../components/ui/button";
import type { CaptureJdResponse } from "../../lib/autofill/autofill-messaging";
import type { ApplicationSummary } from "../../lib/offeros-api";
import type { FillApi } from "./fill-api";

/**
 * One-click "Add this job": capture the JD off the active tab, let the user
 * confirm/edit title + company, dedup by job URL, then create the
 * application + task in one call. Only rendered when there's no active fill
 * task for this tab (see the `!bundle` gate at the call site). Owns no state
 * outside itself — the call site keys it on the job identity (`jobKeyRef`,
 * the same signal that drives `resetTaskMode()` on a job change) so
 * navigating the same tab to a different job remounts it fresh instead of
 * leaving a stale "Added"/"Already tracked" card showing forever.
 */
export function AddJobCard({
  capture,
  api,
  openApplication,
}: {
  capture: () => Promise<CaptureJdResponse>;
  api: Pick<FillApi, "findApplicationsByJobUrl" | "createTaskFromJd">;
  openApplication: (applicationId: string) => void;
}) {
  const [captured, setCaptured] = useState<CaptureJdResponse | null>(null);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [dedupMatches, setDedupMatches] = useState<ApplicationSummary[] | null>(null);
  const [createdApplicationId, setCreatedApplicationId] = useState<string | null>(null);
  // Guards the mutating create call (both entry points funnel through doCreate) against
  // a double-click firing it twice before the `busy`-driven disabled state re-renders —
  // mirrors the parent panel's pendingRef idiom.
  const pendingRef = useRef(false);

  const onAddThisJob = async () => {
    setBusy(true);
    try {
      const res = await capture();
      setCaptured(res);
      // Prefer the sanitized structured (JSON-LD) fields; fall back to the engine's
      // sanitized page-meta guess (h1/doc title, og:site_name/hostname) rather than
      // leaving the form blank on a DOM-only capture — still just a starting point,
      // the user reviews/edits before Create.
      setTitle(res.structuredTitle ?? res.metaTitle ?? "");
      setCompany(res.structuredCompany ?? res.metaCompany ?? "");
      setDedupMatches(null);
      setCreatedApplicationId(null);
    } finally {
      setBusy(false);
    }
  };

  const doCreate = async () => {
    if (!captured || pendingRef.current) return;
    pendingRef.current = true;
    setBusy(true);
    try {
      const created = await api.createTaskFromJd({
        jobTitle: title.trim(),
        companyName: company.trim(),
        jobUrl: captured.url,
        jdText: captured.jd,
      });
      if (created.ok) setCreatedApplicationId(created.value.applicationId);
    } finally {
      pendingRef.current = false;
      setBusy(false);
    }
  };

  const onCreate = async () => {
    if (!captured) return;
    setBusy(true);
    try {
      const dedup = await api.findApplicationsByJobUrl(captured.url);
      if (dedup.ok && dedup.value.length > 0) {
        setDedupMatches(dedup.value);
        return;
      }
      await doCreate();
    } finally {
      setBusy(false);
    }
  };

  const onCancel = () => {
    setCaptured(null);
    setDedupMatches(null);
    setCreatedApplicationId(null);
  };

  if (createdApplicationId) {
    return (
      <div className="mt-3 rounded-xl bg-bg-base p-3">
        <p className="text-caption text-success">Added — tracked in OfferOS.</p>
        <div className="mt-2 flex gap-2">
          <Button
            variant="primary"
            className="rounded-full"
            onClick={() => openApplication(createdApplicationId)}
          >
            Open in OfferOS
          </Button>
          <Button className="rounded-full" onClick={onCancel}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  if (dedupMatches) {
    return (
      <div className="mt-3 rounded-xl bg-bg-base p-3">
        <p className="text-caption text-text-secondary">Already tracked.</p>
        <div className="mt-2 flex gap-2">
          <Button
            variant="primary"
            className="rounded-full"
            onClick={() => openApplication(dedupMatches[0]!.id)}
          >
            Open existing
          </Button>
          <Button className="rounded-full" disabled={busy} onClick={() => void doCreate()}>
            Create anyway
          </Button>
        </div>
        <Button className="mt-2 rounded-full" onClick={onCancel}>
          Back
        </Button>
      </div>
    );
  }

  if (captured) {
    if (captured.source === "none") {
      return (
        <div className="mt-3 rounded-xl bg-bg-base p-3">
          <p className="text-caption leading-relaxed text-text-secondary">
            Couldn't read a posting here — open the job posting page.
          </p>
          <Button className="mt-2 rounded-full" onClick={onCancel}>
            Close
          </Button>
        </div>
      );
    }
    return (
      <div className="mt-3 space-y-2 rounded-xl bg-bg-base p-3">
        <label className="block text-caption text-text-tertiary">
          Job title
          <input
            className="mt-1 w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-caption text-text-primary focus:outline-none focus:ring-1 focus:ring-brand"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Job title"
          />
        </label>
        <label className="block text-caption text-text-tertiary">
          Company
          <input
            className="mt-1 w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-caption text-text-primary focus:outline-none focus:ring-1 focus:ring-brand"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            aria-label="Company"
          />
        </label>
        <p className="text-micro text-text-tertiary">{captured.jd.length} characters captured</p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            className="rounded-full"
            disabled={busy || title.trim() === "" || company.trim() === ""}
            onClick={() => void onCreate()}
          >
            Create
          </Button>
          <Button className="rounded-full" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button className="mt-2 rounded-full" disabled={busy} onClick={() => void onAddThisJob()}>
      Add this job
    </Button>
  );
}
