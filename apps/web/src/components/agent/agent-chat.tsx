"use client";

import { useRef, useState } from "react";
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

const SUGGESTIONS = [
  "Why did this one not finish?",
  "What still needs me?",
  "What has been done so far?",
];

export function AgentChat({ applicationId }: { applicationId: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setDraft("");
    setBusy(true);
    setTurns((t) => [...t, { question: trimmed }]);
    // Scroll after the question renders, so the user sees it land.
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    try {
      const result = await api.agent.chat(applicationId, trimmed);
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
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-background p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-body font-semibold text-foreground">Ask about this application</h2>
        <span className="text-caption text-muted-foreground">
          reads your records, never submits
        </span>
      </header>

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
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

      <ol className="flex flex-col gap-4">
        {turns.map((turn, i) => (
          <li key={i} className="flex flex-col gap-2">
            <p className="self-end rounded-2xl bg-primary px-3 py-2 text-body-sm text-primary-foreground">
              {turn.question}
            </p>
            {turn.steps && turn.steps.length > 0 && <StepList steps={turn.steps} />}
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
          placeholder="Ask about this application…"
          aria-label="Ask about this application"
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
      <div ref={endRef} />
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
function StepList({ steps }: { steps: AgentStep[] }) {
  return (
    <ul className="flex flex-col gap-1 rounded-xl bg-bg-base p-2.5">
      {steps.map((step, i) => (
        <li key={i} className="flex items-baseline gap-2 text-caption">
          <span aria-hidden className={step.ok ? "text-success" : "text-warning"}>
            {step.ok ? "✓" : "!"}
          </span>
          <span className="font-medium text-text-secondary">{step.tool}</span>
          <span className="text-muted-foreground">— {step.summary}</span>
          {step.reason && <span className="text-muted-foreground/70">({step.reason})</span>}
        </li>
      ))}
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
