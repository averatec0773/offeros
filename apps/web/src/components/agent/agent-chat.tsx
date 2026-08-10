"use client";

import { useEffect, useRef, useState } from "react";
import { api, isLlmNotConfigured } from "@/lib/api-client";
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
export function AgentChat({ applicationId }: { applicationId?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

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
        const thread = await api.agent.chatHistory(applicationId);
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
  }, [applicationId]);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setDraft("");
    setBusy(true);
    setTurns((t) => [...t, { question: trimmed }]);
    // Scroll after the question renders, so the user sees it land.
    scrollList();
    try {
      const result = await api.agent.chat(trimmed, applicationId);
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
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-body font-semibold text-foreground">
          {applicationId ? "Ask about this application" : "Ask about your applications"}
        </h2>
        <span className="text-caption text-muted-foreground">
          two changes per turn · never submits
        </span>
      </header>

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {(applicationId ? SUGGESTIONS.one : SUGGESTIONS.all).map((s) => (
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

      {/* The list scrolls INSIDE this box; the page never moves. Bounded so
          the composer stays reachable however long the thread grows. */}
      <div ref={listRef} className="max-h-[420px] overflow-y-auto">
        <ol className="flex flex-col gap-4">
          {turns.map((turn, i) => (
            <li key={i} className="flex flex-col gap-2">
              <p className="self-end rounded-2xl bg-primary px-3 py-2 text-body-sm text-primary-foreground">
                {turn.question}
              </p>
              {turn.steps && turn.steps.length > 0 && (
                <StepList steps={turn.steps} fallbackApplicationId={applicationId} />
              )}
              {turn.answer && (
                <p className="whitespace-pre-wrap text-body-sm text-foreground">{turn.answer}</p>
              )}
              {turn.incomplete && (
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
          placeholder={applicationId ? "Ask about this application…" : "Ask about your search…"}
          aria-label={applicationId ? "Ask about this application" : "Ask about your applications"}
          disabled={busy}
          className="flex-1 rounded-full border border-border bg-bg-base px-4 py-2 text-body-sm outline-none focus:border-primary disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="rounded-full bg-primary px-4 py-2 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
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
/** Steps whose output lives in a workspace — a produced artifact the user
 *  will want to OPEN, not just hear about. The link is the fix for a real
 *  report: "the agent tailored my résumé and I had no idea where it went". */
const ARTIFACT_STEPS = new Set(["tailor_resume", "generate_cover_letter"]);

/** Collapse the tool trail once it is longer than this — one glance says
 *  "the agent worked", the disclosure says exactly what it did. */
const COLLAPSE_FROM = 3;

function StepList({
  steps,
  fallbackApplicationId,
}: {
  steps: AgentStep[];
  fallbackApplicationId?: string;
}) {
  const [open, setOpen] = useState(steps.length < COLLAPSE_FROM);
  const did = steps.filter((s) => s.acted).length;
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
        {steps.length} steps
        {did > 0 && <span className="font-semibold text-primary">· {did} did</span>}
        {failed > 0 && <span className="text-warning">· {failed} failed</span>}
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
          </button>
        </li>
      )}
      {steps.map((step, i) => {
        const workspaceId = step.applicationId ?? fallbackApplicationId;
        const linkToWorkspace = step.ok && ARTIFACT_STEPS.has(step.tool) && workspaceId;
        return (
          <li key={i} className="flex items-baseline gap-2 text-caption">
            <span aria-hidden className={step.ok ? "text-success" : "text-warning"}>
              {step.ok ? "✓" : "!"}
            </span>
            {/* A step that changed something is not the same as a step that
                looked at something, and the difference should not need reading
                the tool name to spot. */}
            {step.acted && (
              <span className="rounded-full bg-primary/10 px-1.5 text-micro font-semibold text-primary">
                did
              </span>
            )}
            <span className="font-medium text-text-secondary">{step.tool}</span>
            <span className="text-muted-foreground">— {step.summary}</span>
            {linkToWorkspace && (
              <a
                href={`/applications/${workspaceId}`}
                className="shrink-0 font-semibold text-primary hover:underline"
              >
                view in workspace →
              </a>
            )}
            {step.reason && <span className="text-muted-foreground/70">({step.reason})</span>}
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
