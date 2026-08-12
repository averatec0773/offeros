import { Pencil } from "lucide-react";
import type { ApplicationInfo } from "@offeros/core";

function ActionButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center rounded-full bg-primary px-3.5 py-1.5 text-caption font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
    >
      {children}
    </button>
  );
}

export function ActionRequiredCard({
  applicationInfo,
  onReFill,
  onFixed,
  onApplied,
}: {
  applicationInfo: ApplicationInfo;
  onReFill?: () => void;
  onFixed?: () => void;
  onApplied?: () => void;
}) {
  const missing = applicationInfo.missingFields ?? [];
  // Required fields, because that is what the sentence below says.
  //
  // This used to read `filledFields` over `totalFields` — every field the
  // engine filled over every control it met, including the ones it correctly
  // left alone. On a real form that produced "23/73 required fields filled"
  // when the truth was 17 of 24: both numbers were about a different population
  // than the words around them. Records written before the required counts
  // existed fall back to what can be derived from the lists they do have.
  const requiredTotal =
    applicationInfo.requiredFields?.length ??
    (applicationInfo.requiredFilledFields?.length ?? 0) + missing.length;
  const requiredFilled =
    applicationInfo.requiredFilledFields?.length ?? Math.max(requiredTotal - missing.length, 0);

  return (
    <div className="rounded-xl bg-warn-bg p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-body font-semibold text-foreground">
          <Pencil className="size-4" />
          Fill out application form
        </div>
        <div className="flex items-center gap-1.5 text-caption font-semibold text-foreground/70">
          <span className="size-2 rounded-full bg-warn" />
          Action Required
        </div>
      </div>

      <p className="mt-3 text-body text-foreground">
        <span className="font-semibold">
          {requiredFilled}/{requiredTotal} required fields filled
        </span>
      </p>
      <p className="mt-1 text-body text-foreground/75">
        Please fill in these {missing.length} missing {missing.length === 1 ? "field" : "fields"} in
        the browser to finish the application.
      </p>

      <ul className="mt-2 space-y-1">
        {missing.map((field) => (
          <li key={field} className="flex items-center gap-2 text-body font-medium text-foreground">
            <span className="size-1 rounded-full bg-foreground/60" />
            {field}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton onClick={onApplied}>I&apos;ve Applied.</ActionButton>
        <ActionButton onClick={onReFill}>Re-fill</ActionButton>
        <ActionButton onClick={onFixed}>Fixed</ActionButton>
      </div>
    </div>
  );
}
