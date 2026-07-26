import { Sparkles } from "lucide-react";

export function SubmitGateCard({ onMarkSubmitted }: { onMarkSubmitted?: () => void }) {
  return (
    <div className="rounded-2xl bg-warn-bg p-4">
      <div className="flex items-center gap-1.5 text-body font-semibold text-foreground">
        <Sparkles className="size-4" />
        Ready to submit
      </div>
      <p className="mt-2 text-body text-foreground/80">
        Finish submitting the application on the ATS page, then mark it here.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onMarkSubmitted}
          className="inline-flex items-center rounded-full bg-primary px-3.5 py-1.5 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
        >
          Mark as submitted
        </button>
      </div>
    </div>
  );
}
