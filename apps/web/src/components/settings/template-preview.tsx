"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/api-client";

/** What to render: an unsaved draft (content + renderer) or a saved template id. */
export type PreviewSource =
  { content: string; renderer: string; scaffoldHints?: string } | { id: string };

type State =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; error: string; logExcerpt?: string };

/**
 * A modal that renders a template's preview PDF inline. It fetches on mount
 * (and whenever `source` changes), turns the returned blob into an object URL
 * for an `<iframe>`, and revokes that URL on unmount/re-fetch. LaTeX compile
 * failures surface the enveloped error with the log excerpt behind a
 * "show details" toggle. Keyed by the parent so each open remounts fresh.
 */
export function TemplatePreview({
  source,
  title = "Cover letter",
  onClose,
}: {
  source: PreviewSource;
  title?: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: "loading" });
    setShowDetails(false);
    api.templates
      .preview(source)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          objectUrl = URL.createObjectURL(result.blob);
          setState({ status: "ready", url: objectUrl });
        } else {
          setState({ status: "error", error: result.error, logExcerpt: result.logExcerpt });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", error: "Couldn't render the preview." });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Template preview"
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full max-h-[85vh] w-full max-w-[820px] flex-col overflow-hidden rounded-2xl border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h3 className="text-body font-semibold text-foreground">{title} preview</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-caption font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
            Close
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-4">
          {state.status === "loading" && (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-caption text-muted-foreground">Rendering…</p>
            </div>
          )}

          {state.status === "error" && (
            <div className="text-caption text-destructive">
              <p>{state.error}</p>
              {state.logExcerpt && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowDetails((v) => !v)}
                    className="mt-1 text-caption font-medium text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {showDetails ? "Hide details" : "Show details"}
                  </button>
                  {showDetails && (
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-2 text-micro text-foreground">
                      {state.logExcerpt}
                    </pre>
                  )}
                </>
              )}
            </div>
          )}

          {state.status === "ready" && (
            <iframe
              title="Template preview"
              src={state.url}
              className="min-h-0 flex-1 rounded-xl border border-border bg-muted"
            />
          )}
        </div>
      </div>
    </div>
  );
}
