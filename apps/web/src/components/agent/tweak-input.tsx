"use client";

import { useState } from "react";
import type { ArtifactVersion } from "@offeros/core";
import type { LineDiff } from "@/lib/diff";
import { api } from "@/lib/api-client";

export function TweakInput({
  taskId,
  kind,
  onResult,
  onCancel,
}: {
  taskId: string;
  kind: "resume" | "cover-letter";
  onResult: (result: { version: ArtifactVersion; diff: LineDiff }) => void;
  onCancel?: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!instruction.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await api.agentTasks.tweak(taskId, kind, instruction.trim());
      onResult(result);
      setInstruction("");
    } catch {
      setError("Couldn't apply that tweak. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <textarea
        rows={2}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder="Tell the agent what to change…"
        className="w-full resize-none bg-transparent px-1 pt-1 text-body text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
      {error && <p className="px-1 text-caption text-destructive">{error}</p>}
      <div className="mt-2 flex items-center justify-end gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center rounded-full px-3 py-1.5 text-caption font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={pending || !instruction.trim()}
          className="inline-flex items-center rounded-full bg-primary px-3.5 py-1.5 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
        >
          {pending ? "Applying…" : "Apply Tweak"}
        </button>
      </div>
    </div>
  );
}
