"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { checkResume, structuredResumeSchema, type ResumeHeader } from "@offeros/core";

/**
 * A résumé checkup that costs nothing.
 *
 * Every check is a pure function of the document (see `packages/core`'s
 * resume-check.ts) — no model call, no network, no API credit. That is worth
 * saying on screen, because everything else in this product that reads a
 * document does spend something, and a person who has learned to be careful
 * about pressing buttons here should be able to press this one freely.
 *
 * Failures are shown expanded and passes are folded away: the list is a to-do,
 * not a score.
 */
export function ResumeCheckup({
  resumeData,
  text,
  header,
}: {
  resumeData: unknown;
  text: string;
  header?: ResumeHeader;
}) {
  const [showPasses, setShowPasses] = useState(false);

  const findings = useMemo(
    () =>
      checkResume({
        resume: structuredResumeSchema.parse(resumeData ?? {}),
        text,
        ...(header ? { header } : {}),
      }),
    [resumeData, text, header],
  );

  if (findings.length === 0) return null;
  const problems = findings.filter((f) => !f.ok);
  const passes = findings.filter((f) => f.ok);

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-body font-semibold text-foreground">Checkup</h2>
        <span className="text-micro text-muted-foreground">Free — no AI credit</span>
      </div>
      <p className="mt-1 text-caption text-muted-foreground">
        {problems.length === 0
          ? "Nothing to fix by these checks."
          : `${problems.length} thing${problems.length === 1 ? "" : "s"} worth a look.`}
      </p>

      <ul className="mt-3 space-y-2">
        {problems.map((f) => (
          <li key={f.ruleId + f.where} className="flex gap-2">
            <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <div className="min-w-0">
              <p className="text-caption font-medium text-foreground">{f.title}</p>
              <p className="text-caption text-muted-foreground">{f.detail}</p>
              {f.where && <p className="truncate text-micro text-muted-foreground">{f.where}</p>}
            </div>
          </li>
        ))}
      </ul>

      {passes.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowPasses((v) => !v)}
            aria-expanded={showPasses}
            className="mt-3 inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={`size-4 transition-transform ${showPasses ? "rotate-180" : ""}`}
              aria-hidden
            />
            {passes.length} check{passes.length === 1 ? "" : "s"} passed
          </button>
          {showPasses && (
            <ul className="mt-2 space-y-1.5">
              {passes.map((f) => (
                <li key={f.ruleId} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-caption text-foreground">{f.title}</p>
                    <p className="text-caption text-muted-foreground">{f.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
