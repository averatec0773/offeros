import { Button } from "../../components/ui/button";

/** Generate → preview → attach card, shared by the résumé and cover-letter
 *  flows. Pure UI — the caller owns all state and handlers. */
export function ArtifactCard({
  title,
  cta,
  busyLabel,
  hint,
  previewTitle,
  attachCta,
  busy,
  error,
  pdf,
  attached,
  onGenerate,
  onAttach,
}: {
  title: string;
  cta: string;
  busyLabel: string;
  hint: string;
  previewTitle: string;
  attachCta: string;
  busy: boolean;
  error: string | null;
  pdf: { url: string; fileName: string } | null;
  attached: boolean;
  onGenerate: () => void;
  onAttach: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl bg-bg-base p-3">
      <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
        {title}
      </p>
      {!pdf ? (
        <>
          <Button variant="primary" className="rounded-full" disabled={busy} onClick={onGenerate}>
            {busy ? busyLabel : cta}
          </Button>
          <p className="mt-1.5 text-caption leading-relaxed text-text-secondary">{hint}</p>
        </>
      ) : (
        <>
          <iframe
            src={pdf.url}
            title={previewTitle}
            className="h-72 w-full rounded-xl border border-border-subtle bg-white"
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="primary"
              className="rounded-full"
              disabled={busy || attached}
              onClick={onAttach}
            >
              {attached ? "Attached" : attachCta}
            </Button>
            <Button className="rounded-full" disabled={busy} onClick={onGenerate}>
              {busy ? busyLabel : "Regenerate"}
            </Button>
          </div>
          {attached && (
            <p className="mt-1.5 text-caption text-success">Attached — review it on the page.</p>
          )}
        </>
      )}
      {error && <p className="mt-1.5 text-caption text-warning">{error}</p>}
    </div>
  );
}
