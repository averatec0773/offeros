"use client";

import { useEffect, useState } from "react";
import type { AnswerGap, AnswerGaps } from "@offeros/core";
import { api } from "@/lib/api-client";
import { LabeledInput } from "./fields";
import type { AnswerBank } from "./use-answer-bank";

/**
 * The questions your applications keep asking that you have never answered.
 *
 * This is the first thing OfferOS does with the history it has been
 * accumulating: every form it has filled, and every form a platform described
 * before you applied, reduced to "these are the questions that keep costing you
 * time". Answer one here and it stops being a question — the fill engine reads
 * the same bank on every future application.
 *
 * Deterministic and free. No model call is made anywhere in this feature; the
 * matching is the same the fill engine uses, so a question shown as unanswered
 * really is one the fill would leave for you.
 */
export function AnswerGapsCard({ bank }: { bank: AnswerBank }) {
  const [data, setData] = useState<AnswerGaps | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.answers
      .gaps()
      .then(setData)
      .catch(() => setError("Couldn't work out which questions are unanswered."));
  };
  // Reloaded whenever the bank changes: answering a question here has to make
  // it leave this list, and the bank is what it left through.
  useEffect(load, [bank.entries]);

  async function save(gap: AnswerGap) {
    if (draft.trim() === "") return;
    setSaving(true);
    setError(null);
    try {
      await bank.save({
        questionPatterns: [gap.question],
        answer: draft.trim(),
        type: "text",
        category: "screening",
      });
      setAnswering(null);
      setDraft("");
    } catch {
      setError("Couldn't save that answer.");
    } finally {
      setSaving(false);
    }
  }

  if (data === null) {
    return <p className="text-body text-muted-foreground">Looking through your applications…</p>;
  }

  if (data.gaps.length === 0 && data.notOurs.length === 0) {
    return (
      <p className="text-body text-muted-foreground">
        Nothing outstanding — every question your applications have asked so far has an answer.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-muted-foreground">
        Questions your applications have asked that you have no answer for, most-asked first.
        Answering one here means every future form gets it filled in.
      </p>
      {error && <p className="text-caption text-destructive">{error}</p>}

      {data.gaps.map((gap) => (
        <div key={gap.questionKey} className="rounded-xl border border-border bg-background p-3">
          <p className="text-body font-medium text-foreground">{gap.question}</p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            {describeSightings(gap)}
            {gap.required ? " · required" : ""}
            {gap.vendors.length > 0 ? ` · ${gap.vendors.join(", ")}` : ""}
            {gap.origins.includes("fill") ? "" : " · from the posting, not yet filled"}
          </p>

          {answering === gap.questionKey ? (
            <div className="mt-2 flex flex-col gap-2">
              <LabeledInput label="Your answer" value={draft} onChange={setDraft} />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAnswering(null)}
                  className="rounded-full border border-border px-3 py-1.5 text-caption font-medium text-foreground transition-colors hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save(gap)}
                  className="rounded-full bg-primary px-3 py-1.5 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save answer"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAnswering(gap.questionKey);
                setDraft("");
              }}
              className="mt-2 rounded-full border border-border px-3 py-1.5 text-caption font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Answer this now
            </button>
          )}
        </div>
      ))}

      {data.total > data.gaps.length && (
        <p className="text-caption text-muted-foreground">
          {data.total - data.gaps.length} more, not shown.
        </p>
      )}

      {data.hasUnattributedSightings && (
        // The count comes from applications we can attribute a sighting to.
        // Older records kept a tally without one, so the real number can be
        // higher — said out loud rather than quietly rounded.
        <p className="text-caption text-muted-foreground">
          Some older records don&apos;t say which application they came from, so these counts can be
          low.
        </p>
      )}

      {data.notOurs.length > 0 && (
        <div className="rounded-xl border border-dashed border-border p-3">
          <p className="text-body font-medium text-foreground">
            Questions OfferOS won&apos;t answer for you
          </p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            Self-identification, work authorisation, and anything else that is a statement about you
            rather than a fact OfferOS can look up. You can still store answers — the Equal
            Employment section above is where — and forms will fill from them. OfferOS just never
            invents one.
          </p>
          <ul className="mt-2 space-y-1">
            {data.notOurs.map((gap) => (
              <li key={gap.questionKey} className="text-caption text-muted-foreground">
                {gap.question}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * How often this has come up, said only as far as the data supports.
 *
 * "Asked on N of your applications" is a claim about attribution, so it is only
 * made when the sightings carried one; otherwise the honest sentence is the
 * plain tally.
 */
function describeSightings(gap: AnswerGap): string {
  if (gap.seenOnApplications > 0) {
    return gap.seenOnApplications === 1
      ? "Asked on 1 of your applications"
      : `Asked on ${gap.seenOnApplications} of your applications`;
  }
  return gap.timesSeen === 1 ? "Seen once" : `Seen ${gap.timesSeen} times`;
}
