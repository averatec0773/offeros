"use client";

import { useMemo, useState } from "react";
import { Banknote, CalendarClock, MapPin, Sparkles, TrendingUp } from "lucide-react";
import {
  looksLikeCapturedCode,
  SUSPECT_JD_NOTICE,
  type JdAnalysis,
  type JobInfo,
} from "@offeros/core";
import { missingSkillsInJd, profileSkillsInJd, segmentJd } from "@/lib/jd-skills";
import { cn } from "@/lib/utils";
import { SpendChip } from "./spend-chip";

/**
 * The job description, in two layers that cost very different things.
 *
 * The default layer is free and always on: the employer's own text, with the
 * applicant's skills highlighted where the posting names them. No token, no
 * network, no "upload your résumé to see how you match" — the profile is
 * already here, and the matching is the same `@offeros/autofill` pair the fit
 * card's gaps come from, so the two can never contradict each other.
 *
 * The second layer costs one call on the user's own key, and only when they
 * press the button. Its result is stored, so it is paid for once.
 *
 * Raw and interpreted are PEERS, not a stack: a tab switch, so the reading
 * never buries the source and the source never buries the reading.
 */

/** Roughly how much of the description to show before asking. Lines rather
 *  than characters, because postings are list-shaped and a character budget
 *  cuts them mid-bullet. */
const COLLAPSED_LINES = 12;

type View = "text" | "reading";

/**
 * Where a description came from, in the plainest words available.
 *
 * Worth saying because the sources are not equally trustworthy: a platform's
 * API returns the posting the employer wrote, while text scraped out of a page
 * can pick up navigation and boilerplate. A reader deciding whether to trust
 * what they are reading should not have to guess which one this was.
 */
const SOURCE_NOTE: Record<string, string> = {
  "vendor-api": "From the job board's own listing.",
  page: "Extracted from the posting page — may include some page furniture.",
  browser: "Captured from the page as your browser rendered it.",
  manual: "You pasted this in.",
};

export function JdCard({
  jobInfo,
  jdText,
  jdSource,
  analysis,
  profileSkills,
  onAnalyze,
  onSaveJdText,
  onCheckPosting,
  analyzing = false,
  saving = false,
}: {
  jobInfo: JobInfo;
  jdText: string;
  /** Absent for descriptions saved before provenance was recorded — shown as
   *  nothing rather than as a guess. */
  jdSource?: string;
  analysis: JdAnalysis | null;
  profileSkills: string[];
  onAnalyze: (instruction?: string) => void;
  onSaveJdText: (text: string) => void;
  onCheckPosting: () => void;
  analyzing?: boolean;
  saving?: boolean;
}) {
  const [view, setView] = useState<View>("text");
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [draft, setDraft] = useState("");

  const have = useMemo(() => profileSkillsInJd(jdText, profileSkills), [jdText, profileSkills]);
  const missing = useMemo(
    () => missingSkillsInJd(jdText, analysis, profileSkills),
    [jdText, analysis, profileSkills],
  );

  // Cheap enough to run on every render — it is a character scan over text the
  // page is about to render anyway.
  const suspectJd = useMemo(() => looksLikeCapturedCode(jdText), [jdText]);
  const lines = jdText.split("\n");
  const truncated = !expanded && lines.length > COLLAPSED_LINES;
  const shown = truncated ? lines.slice(0, COLLAPSED_LINES).join("\n") : jdText;
  const segments = useMemo(() => segmentJd(shown, have, missing), [shown, have, missing]);

  const meta = [
    jobInfo.salaryDesc && { icon: Banknote, text: jobInfo.salaryDesc, strong: true },
    jobInfo.jobLocation && { icon: MapPin, text: jobInfo.jobLocation },
    jobInfo.publishTimeDesc && { icon: CalendarClock, text: jobInfo.publishTimeDesc },
    jobInfo.jobSeniority && { icon: TrendingUp, text: jobInfo.jobSeniority },
  ].filter((m): m is { icon: typeof Banknote; text: string; strong?: boolean } => Boolean(m));

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-body font-semibold text-foreground">Job description</h2>
        {jdText.trim() !== "" && (
          <div className="flex items-center gap-2">
            {analysis && (
              <div
                role="tablist"
                aria-label="Job description view"
                className="inline-flex overflow-hidden rounded-full ring-1 ring-inset ring-border"
              >
                {(
                  [
                    ["text", "Posting"],
                    ["reading", "AI reading"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={view === value}
                    onClick={() => setView(value)}
                    className={cn(
                      "px-3 py-1 text-caption font-semibold transition-colors",
                      view === value
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-foreground hover:bg-muted",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <input
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="Optional: a lens…"
              aria-label="Reading viewpoint"
              className="w-36 min-w-0 rounded-full border border-border bg-background px-3 py-1 text-caption text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <SpendChip
              onClick={() => onAnalyze(instruction.trim() || undefined)}
              disabled={analyzing}
              label={analysis ? "Re-read" : "AI reading"}
              busyLabel="Reading…"
              busy={analyzing}
            />
          </div>
        )}
      </header>

      {meta.length > 0 && (
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {meta.map((m) => (
            <li
              key={m.text}
              className={cn(
                "flex items-center gap-1.5 text-caption",
                m.strong ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              <m.icon aria-hidden className="size-3.5 shrink-0" />
              {m.text}
            </li>
          ))}
        </ul>
      )}

      {/* A description that reads like captured page source. The capture bug is
          fixed, but the records it already made are not, and a wall of minified
          JavaScript looks like a wall of text at a glance. One line, offering
          the two ways out. */}
      {suspectJd && (
        <div className="mt-3 rounded-xl border border-warning/40 bg-warning/5 p-3">
          <p className="text-caption leading-relaxed text-foreground">{SUSPECT_JD_NOTICE}</p>
          {onCheckPosting && (
            <button
              type="button"
              onClick={onCheckPosting}
              className="mt-2 rounded-full border border-border px-3 py-1 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Fetch it from the posting
            </button>
          )}
        </div>
      )}

      {jdText.trim() === "" ? (
        <EmptyJd
          editing={editing}
          draft={draft}
          saving={saving}
          onDraft={setDraft}
          onStart={() => setEditing(true)}
          onCancel={() => {
            setEditing(false);
            setDraft("");
          }}
          onSave={() => {
            onSaveJdText(draft);
            setEditing(false);
          }}
          onCheckPosting={onCheckPosting}
        />
      ) : view === "reading" && analysis ? (
        <Reading analysis={analysis} />
      ) : (
        <>
          {(have.length > 0 || missing.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {have.map((skill) => (
                <span
                  key={`have-${skill}`}
                  className="rounded-full bg-success/15 px-2.5 py-0.5 text-caption font-medium text-foreground"
                >
                  {skill}
                </span>
              ))}
              {missing.map((skill) => (
                <span
                  key={`missing-${skill}`}
                  className="rounded-full bg-warn-bg px-2.5 py-0.5 text-caption font-medium text-foreground"
                >
                  {skill}
                </span>
              ))}
            </div>
          )}

          <p className="mt-3 whitespace-pre-wrap break-words text-body-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
            {segments.map((segment, i) =>
              segment.kind === "plain" ? (
                <span key={i}>{segment.text}</span>
              ) : (
                <mark
                  key={i}
                  data-skill={segment.kind}
                  title={
                    segment.kind === "have"
                      ? "On your profile"
                      : "Asked for, and not on your profile"
                  }
                  className={cn(
                    "rounded px-0.5",
                    segment.kind === "have"
                      ? "bg-success/20 text-foreground"
                      : "bg-warn-bg text-foreground",
                  )}
                >
                  {segment.text}
                </mark>
              ),
            )}
            {truncated && "…"}
          </p>

          {jdSource && SOURCE_NOTE[jdSource] && (
            <p className="mt-2 text-caption text-muted-foreground">{SOURCE_NOTE[jdSource]}</p>
          )}

          {lines.length > COLLAPSED_LINES && (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={expanded}
              className="mt-2 text-caption font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {expanded ? "Show less" : `Show the full posting (${lines.length} lines)`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

const FACT_LABEL: Record<string, string> = {
  salary: "Pay",
  sponsorship: "Sponsorship",
  remote: "Remote",
  deadline: "Deadline",
};

/**
 * The four facts, in three states.
 *
 * "Not mentioned" is written out rather than hidden, because the difference
 * between "this posting says it does not sponsor" and "this posting says
 * nothing about sponsoring" is the difference between not applying and
 * applying. A blank would collapse the two.
 */
function JobFacts({ facts }: { facts: NonNullable<JdAnalysis["jobFacts"]> }) {
  const rows = (["salary", "sponsorship", "remote", "deadline"] as const).map((key) => ({
    key,
    label: FACT_LABEL[key]!,
    fact: facts[key],
  }));
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
      {rows.map(({ key, label, fact }) => (
        <div key={key} className="contents">
          <dt className="text-caption font-medium text-muted-foreground">{label}</dt>
          <dd
            className={cn(
              "text-caption",
              fact.state === "stated" && "text-foreground",
              fact.state === "denied" && "font-medium text-warning",
              fact.state === "not-mentioned" && "text-muted-foreground",
            )}
          >
            {fact.state === "not-mentioned" ? "Not mentioned" : fact.detail || fact.state}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The structured reading, once it has been paid for. */
function Reading({ analysis }: { analysis: JdAnalysis }) {
  const sections: [string, string[]][] = [
    ["Responsibilities", analysis.responsibilities],
    ["Required", analysis.requiredSkills],
    ["Nice to have", analysis.preferredSkills],
    ["Gaps", analysis.gaps],
  ];
  return (
    <div className="mt-3 space-y-3">
      {analysis.instruction && (
        <p className="rounded-xl bg-muted px-3 py-2 text-caption text-muted-foreground">
          Read through your lens: &ldquo;{analysis.instruction}&rdquo;
        </p>
      )}
      {analysis.jobFacts && <JobFacts facts={analysis.jobFacts} />}
      {analysis.summary && (
        <p className="text-body-sm leading-relaxed text-foreground/90">{analysis.summary}</p>
      )}
      {sections.map(([heading, items]) =>
        items.length === 0 ? null : (
          <div key={heading}>
            <h3 className="text-caption font-semibold text-muted-foreground">{heading}</h3>
            <ul className="mt-1 space-y-1">
              {items.map((item) => (
                <li key={item} className="text-caption text-foreground/85">
                  · {item}
                </li>
              ))}
            </ul>
          </div>
        ),
      )}
    </div>
  );
}

/** No description yet — two ways out, neither of which costs a token. */
function EmptyJd({
  editing,
  draft,
  saving,
  onDraft,
  onStart,
  onCancel,
  onSave,
  onCheckPosting,
}: {
  editing: boolean;
  draft: string;
  saving: boolean;
  onDraft: (value: string) => void;
  onStart: () => void;
  onCancel: () => void;
  onSave: () => void;
  onCheckPosting: () => void;
}) {
  if (editing) {
    return (
      <div className="mt-3">
        <textarea
          autoFocus
          rows={10}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          aria-label="Job description"
          placeholder="Paste the posting here…"
          className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-body-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saving || draft.trim() === ""}
            className="rounded-full bg-primary px-3.5 py-1.5 text-caption font-semibold text-primary-foreground press hover:bg-primary/85 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-3 py-1.5 text-caption font-semibold text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-body text-muted-foreground">
        No description saved for this job yet — so there is nothing to match your skills against.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onStart}
          className="rounded-full bg-primary px-3.5 py-1.5 text-caption font-semibold text-primary-foreground press hover:bg-primary/85"
        >
          Paste it
        </button>
        <button
          type="button"
          onClick={onCheckPosting}
          className="rounded-full border border-border px-3.5 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
        >
          Fetch it from the posting
        </button>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-caption text-muted-foreground">
        <Sparkles aria-hidden className="size-3 shrink-0" />
        Both are free — neither calls your AI provider.
      </p>
    </div>
  );
}
