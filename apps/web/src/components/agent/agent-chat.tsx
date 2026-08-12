"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api, isLlmNotConfigured } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { AgentStep } from "@/server/agent/loop";

/**
 * The agent chat.
 *
 * Every answer arrives with the steps that produced it, and they are shown, not
 * hidden behind a disclosure the user has to know to open. This is the point of
 * the whole feature: an assistant that says "three of these failed for one
 * reason" is only worth trusting if you can see which records it read to say
 * so. The steps ARE the status display — there is no separate spinner-with-
 * vibes, because "what is it doing" and "what did it read" are the same
 * question.
 */

interface Turn {
  question: string;
  answer?: string;
  steps?: AgentStep[];
  error?: string;
  /** Set when the loop stopped at its step budget rather than by choosing to
   *  answer — the difference matters, so it is said rather than implied. */
  incomplete?: boolean;
}

/** What to offer before the user has asked anything. Different questions make
 *  sense when the conversation is about one job than about all of them. */
const SUGGESTIONS = {
  one: ["Why did this one not finish?", "What still needs me?", "Tailor my résumé for this job"],
  all: [
    "What needs me right now?",
    "Which of these are stuck, and why?",
    "Which should I do first?",
  ],
};

/**
 * Omit `applicationId` for a conversation about every application. The agent
 * then names the job it is working on per tool call, and the trace follows it.
 */
/**
 * `fill` makes the chat expand to its container's height (the message list
 * takes the slack and scrolls internally, composer pinned at the bottom) — the
 * full-page chat layout the /agent console uses. Omitted, it stays a bounded
 * card (max-height message list) for embedding inside a scrolling workspace.
 */
export function AgentChat({
  applicationId,
  contextJob,
  fill = false,
}: {
  applicationId?: string;
  /**
   * The job this conversation arrived pointed at ("Ask" on a row or on the
   * detail page). Shown as a removable chip above the composer, so the user can
   * SEE that the agent knows which job they mean rather than having to trust
   * that it does — and can take it off when the question is about something
   * else. Removing it drops back to the conversation about everything.
   */
  contextJob?: { id: string; company: string; title: string };
  fill?: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  // The chip is the scope. While it is on, every send carries its id (and the
  // thread is that job's thread); dropped, sends carry nothing.
  const [contextOn, setContextOn] = useState(true);
  useEffect(() => setContextOn(true), [contextJob?.id]);
  const scope = contextJob && contextOn ? contextJob.id : applicationId;

  /** Scroll the MESSAGE LIST, never the page. The old scrollIntoView walked
   *  the whole viewport down to the chat after every answer — on a page with
   *  content above the chat, that read as the app "jumping". */
  const scrollList = (smooth = true) => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  };

  // The thread is server-side and shared by scope (this application, or the
  // global console thread) — load it on mount so the conversation survives
  // reloads and follows the user between surfaces. Messages pair up
  // user→assistant in order; a trailing unanswered user message renders as a
  // question still waiting.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const thread = await api.agent.chatHistory(scope);
        if (!live || thread.length === 0) return;
        const loaded: Turn[] = [];
        for (const message of thread) {
          if (message.role === "user") {
            loaded.push({ question: message.content });
          } else if (loaded.length > 0 && loaded[loaded.length - 1]!.answer === undefined) {
            loaded[loaded.length - 1] = {
              ...loaded[loaded.length - 1]!,
              answer: message.content,
              steps: (message.steps as AgentStep[] | undefined) ?? [],
              // Persisted, so the "stopped at the limit" notice survives reload.
              incomplete: message.ranOutOfSteps ?? false,
            };
          }
        }
        setTurns((current) => (current.length === 0 ? loaded : current));
        scrollList(false); // land at the latest message, no animation on mount
      } catch {
        // No history is not an error worth surfacing — the chat just starts fresh.
      }
    })();
    return () => {
      live = false;
    };
  }, [scope]);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setDraft("");
    setBusy(true);
    setTurns((t) => [...t, { question: trimmed }]);
    // Scroll after the question renders, so the user sees it land.
    scrollList();
    try {
      const result = await api.agent.chat(trimmed, scope);
      setTurns((t) =>
        replaceLast(t, {
          question: trimmed,
          answer: result.answer,
          steps: result.steps,
          incomplete: result.ranOutOfSteps,
        }),
      );
    } catch (err) {
      // A missing provider key is the common case and has its own wording;
      // anything else shows what actually came back rather than "went wrong".
      const error = isLlmNotConfigured(err)
        ? "No AI provider is connected. Add a key in Settings → AI."
        : err instanceof Error
          ? err.message
          : "Something went wrong.";
      setTurns((t) => replaceLast(t, { question: trimmed, error }));
    } finally {
      setBusy(false);
      scrollList();
    }
  }

  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-border bg-background p-4",
        fill && "h-full min-h-0",
      )}
    >
      <header className="flex items-baseline justify-between">
        <h2 className="text-body font-semibold text-foreground">
          {scope ? "Ask about this application" : "Ask about your applications"}
        </h2>
        <span className="text-caption text-muted-foreground">
          two changes per turn · never submits
        </span>
      </header>

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {(scope ? SUGGESTIONS.one : SUGGESTIONS.all).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void ask(s)}
              disabled={busy}
              className="rounded-full border border-border px-3 py-1.5 text-caption text-text-secondary transition-colors hover:bg-muted disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* The list scrolls INSIDE this box; the page never moves. In `fill` it
          takes the container's slack (flex-1); otherwise it's a bounded card. */}
      <div
        ref={listRef}
        className={cn("overflow-y-auto", fill ? "min-h-0 flex-1" : "max-h-[420px]")}
      >
        <ol className="flex flex-col gap-4">
          {turns.map((turn, i) => (
            <li key={i} className="flex flex-col gap-2">
              <p className="self-end rounded-2xl bg-primary px-3 py-2 text-body-sm text-primary-foreground">
                {turn.question}
              </p>
              {turn.steps && turn.steps.length > 0 && (
                <StepList steps={turn.steps} fallbackApplicationId={scope} />
              )}
              {turn.answer && (
                <p className="whitespace-pre-wrap text-body-sm text-foreground">{turn.answer}</p>
              )}
              {/* Only when the turn came back empty-handed. A turn that ran out
                  of steps AFTER producing something is not a failed turn, and
                  telling the user to "ask something narrower" next to a résumé
                  it just wrote reads as an apology for the work — the real
                  incident this fixes. The work is the account of the turn. */}
              {turn.incomplete && !producedSomething(turn.steps) && (
                <p className="text-caption text-warning">
                  Stopped at the step limit — ask something narrower and it will get further.
                </p>
              )}
              {turn.error && <p className="text-caption text-destructive">{turn.error}</p>}
              {!turn.answer && !turn.error && <Thinking />}
            </li>
          ))}
        </ol>
      </div>

      {contextJob && contextOn && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/10 py-1 pl-3 pr-1.5 text-caption text-foreground">
            <span className="truncate">
              Context: {contextJob.company} · {contextJob.title}
            </span>
            <button
              type="button"
              onClick={() => setContextOn(false)}
              aria-label={`Remove ${contextJob.title} from the conversation context`}
              className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
        className="flex items-center gap-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={scope ? "Ask about this application…" : "Ask about your search…"}
          aria-label={scope ? "Ask about this application" : "Ask about your applications"}
          disabled={busy}
          className="flex-1 rounded-full border border-border bg-bg-base px-4 py-2 text-body-sm outline-none focus:border-primary disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="rounded-full bg-primary px-4 py-2 text-caption font-semibold text-primary-foreground press hover:bg-primary/85 disabled:opacity-50"
        >
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>
    </section>
  );
}

/**
 * What the agent read, in order.
 *
 * Each row is a tool it chose and the reason it gave for choosing it. A failed
 * step stays on the list: "I looked and there was nothing there" is information,
 * and hiding it would make the answer look better-founded than it is.
 */
/** Steps whose output is a document the user will want to OPEN, not just hear
 *  about. The link is the fix for a real report: "the agent tailored my résumé
 *  and I had no idea where it went". */
const ARTIFACT_STEPS = new Set(["tailor_resume", "generate_cover_letter", "refine_artifact"]);

/** Collapse the tool trail once it is longer than this — one glance says
 *  "the agent worked", the disclosure says exactly what it did. A single
 *  step stays inline; two or more fold. */
const COLLAPSE_FROM = 2;

/** Did this turn actually change something? `acted` is the server's own record
 *  of a verified world-change, not a guess from the tool name. */
function producedSomething(steps?: AgentStep[]): boolean {
  return (steps ?? []).some((s) => s.acted);
}

/**
 * What a change reads as when it is the HEADLINE rather than a row in a trail.
 *
 * The collapsed bar used to say "6 steps · 1 did · 3 failed", which describes
 * the machine's effort and not the user's outcome — and next to an answer that
 * had lost track of the same work, it was the only place a produced résumé was
 * mentioned at all. Counts still exist; they moved into the disclosure, where
 * someone asking "what did it actually run" will look.
 */
const DONE_PHRASE: Record<string, string> = {
  tailor_resume: "Generated a tailored résumé",
  generate_cover_letter: "Wrote a cover letter",
  refine_artifact: "Revised the draft",
  save_answer: "Saved your answer",
  delete_answer: "Removed a saved answer",
  update_application: "Updated this application",
  update_profile: "Updated your profile",
  draft_answer: "Drafted an answer",
  compute_fit: "Scored the fit",
  open_fill: "Opened a fill for the browser panel",
  mark_submitted: "Marked it as submitted",
  check_gate: "Checked what it is waiting on",
};

function donePhrase(step: AgentStep): string {
  if (step.tool === "refine_artifact" && step.artifactKind) {
    return step.artifactKind === "resume" ? "Revised your résumé" : "Revised your cover letter";
  }
  // Falling back to the tool's own summary keeps a new tool honest rather than
  // silent: an unmapped id shows what happened, in the tool's words.
  return DONE_PHRASE[step.tool] ?? step.summary;
}

function StepList({
  steps,
  fallbackApplicationId,
}: {
  steps: AgentStep[];
  fallbackApplicationId?: string;
}) {
  const [open, setOpen] = useState(steps.length < COLLAPSE_FROM);
  const done = steps.filter((s) => s.acted);
  const failed = steps.filter((s) => !s.ok).length;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className="flex w-fit items-center gap-1.5 rounded-xl bg-bg-base px-2.5 py-1.5 text-caption text-muted-foreground transition-colors hover:bg-muted"
      >
        <span aria-hidden>▸</span>
        {done.length > 0 ? (
          // What came of the turn, in the user's terms. The failures along the
          // way are not hidden — they are one click away, and the answer above
          // is where they get explained.
          <span className="font-semibold text-foreground">{done.map(donePhrase).join(" · ")}</span>
        ) : (
          <>
            {steps.length} steps
            {failed > 0 && <span className="text-warning">· {failed} failed</span>}
          </>
        )}
      </button>
    );
  }

  return (
    <ul className="flex flex-col gap-1 rounded-xl bg-bg-base p-2.5">
      {steps.length >= COLLAPSE_FROM && (
        <li>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-expanded={true}
            className="flex items-center gap-1.5 text-caption text-muted-foreground hover:text-foreground"
          >
            <span aria-hidden>▾</span> hide steps
            {/* The tally belongs to the detail, not to the headline. */}
            <span>
              · {steps.length} steps
              {done.length > 0 && ` · ${done.length} did`}
              {failed > 0 && ` · ${failed} failed`}
            </span>
          </button>
        </li>
      )}
      {steps.map((step, i) => {
        const workspaceId = step.applicationId ?? fallbackApplicationId;
        const linkToWorkspace = step.ok && ARTIFACT_STEPS.has(step.tool) && workspaceId;
        // A step that produced a document links to THAT document's workbench —
        // the place it can be read, diffed and exported. Pointing at the
        // application page instead left the user to go hunting for the thing
        // they were just told about. Older persisted steps carry no kind (the
        // tools only started reporting it later), so those keep the link they
        // shipped with rather than guessing a document.
        const docKind = step.artifactKind;
        return (
          // Two clean lines per step: WHO on the first, WHAT on the second.
          // The old single-line flow wrapped summaries mid-phrase and floated
          // the reason into a ragged right column; the reason now lives in a
          // hover title — transparency kept, noise gone.
          <li key={i} className="flex gap-2 text-caption" title={step.reason || undefined}>
            <span aria-hidden className={`mt-px ${step.ok ? "text-success" : "text-warning"}`}>
              {step.ok ? "✓" : "!"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-text-secondary">{step.tool}</span>
                {/* A step that changed something is not the same as a step
                    that looked at something, and the difference should not
                    need reading the tool name to spot. */}
                {step.acted && (
                  <span className="rounded-full bg-primary/10 px-1.5 text-micro font-semibold text-primary">
                    did
                  </span>
                )}
                {linkToWorkspace && (
                  <a
                    href={
                      docKind
                        ? `/applications/${workspaceId}/doc/${docKind}`
                        : `/applications/${workspaceId}`
                    }
                    className="font-semibold text-primary hover:underline"
                  >
                    {docKind ? "open in the workbench →" : "open this application →"}
                  </a>
                )}
              </div>
              <p className="text-muted-foreground">{step.summary}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Thinking() {
  return (
    <p className="text-caption text-muted-foreground" role="status">
      Looking through your records…
    </p>
  );
}

function replaceLast(turns: Turn[], turn: Turn): Turn[] {
  return [...turns.slice(0, -1), turn];
}
