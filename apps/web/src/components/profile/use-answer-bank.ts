"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerEntry } from "@offeros/core";
import { api } from "@/lib/api-client";

/**
 * One answer bank, read once, shared by everything on the page that shows it.
 *
 * The Equal Employment section and the Answers list each used to fetch their
 * own copy and never speak again. So deleting an entry from the list left the
 * EEO row above it still displaying the value, still looking saved — and the
 * user had every reason to believe their answers were set right up until an
 * application went out with the work-authorization question blank. A component
 * showing a value it no longer has is worse than one showing nothing.
 *
 * Holding the list here means a change in either surface is the same change in
 * both. `entriesRef` mirrors it for callers that need to read the current list
 * from inside an async chain, where captured state is a render behind.
 */
export interface AnswerBank {
  /** null until the first load finishes. */
  entries: AnswerEntry[] | null;
  error: string | null;
  /** Save an answer. The server updates the entry for this question, or
   *  creates the first one — the caller never decides which. */
  save(input: Omit<AnswerEntry, "id">): Promise<AnswerEntry>;
  /** Edit one known entry. */
  update(id: string, input: Omit<AnswerEntry, "id">): Promise<AnswerEntry>;
  remove(id: string): Promise<void>;
  /** The current list, readable from inside an async chain. */
  current(): AnswerEntry[];
}

export function useAnswerBank(): AnswerBank {
  const [entries, setEntries] = useState<AnswerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entriesRef = useRef<AnswerEntry[]>([]);

  const put = useCallback((list: AnswerEntry[]) => {
    entriesRef.current = list;
    setEntries(list);
  }, []);

  useEffect(() => {
    api.answers
      .list()
      .then(put)
      .catch(() => setError("Couldn't load answers."));
  }, [put]);

  const save = useCallback(
    async (input: Omit<AnswerEntry, "id">) => {
      const saved = await api.answers.create(input);
      // Upsert on the client too: the server may have returned an entry that
      // was already in the list, and appending it would show it twice.
      const list = entriesRef.current;
      put(
        list.some((e) => e.id === saved.id)
          ? list.map((e) => (e.id === saved.id ? saved : e))
          : [...list, saved],
      );
      return saved;
    },
    [put],
  );

  const update = useCallback(
    async (id: string, input: Omit<AnswerEntry, "id">) => {
      const updated = await api.answers.update(id, input);
      put(entriesRef.current.map((e) => (e.id === id ? updated : e)));
      return updated;
    },
    [put],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.answers.remove(id);
      put(entriesRef.current.filter((e) => e.id !== id));
    },
    [put],
  );

  const current = useCallback(() => entriesRef.current, []);

  return { entries, error, save, update, remove, current };
}
