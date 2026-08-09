import { Button } from "../../components/ui/button";
import type { ArtifactLane } from "./use-artifact-lane";

/** Generate → preview → attach card, shared by the résumé and cover-letter
 *  flows. Pure UI: the words are this component's, the state and the work are
 *  the lane's. */
export function ArtifactCard({
  title,
  cta,
  busyLabel,
  hint,
  previewTitle,
  attachCta,
  lane,
}: {
  title: string;
  cta: string;
  busyLabel: string;
  hint: string;
  previewTitle: string;
  attachCta: string;
  lane: ArtifactLane;
}) {
  const { busy, error, pdf, attached } = lane;
  const onGenerate = () => void lane.onGenerate();
  const onAttach = () => void lane.onAttach();
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
