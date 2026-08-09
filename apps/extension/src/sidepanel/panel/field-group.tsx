import type { FillItem } from "@offeros/autofill";
import { StatusIcon } from "./status-icon";

// Required / Optional checklist group. Each row is clickable — it scrolls the
// page to that field and flashes the highlight — and carries the fill plan's
// per-field reason ("why this value") as its tooltip. An empty group is
// omitted so an ATS that marks nothing required renders no header.
export function FieldGroup({
  title,
  items,
  reasonFor,
  onJump,
  writtenValue,
  revealKey,
}: {
  title: string;
  items: FillItem[];
  reasonFor?: (fieldId: string) => string | undefined;
  onJump?: (fieldId: string) => void;
  /** Value verifiably written to the page for this field this session, if any. */
  writtenValue?: (fieldId: string) => string | undefined;
  /** Changes when a NEW page's fields arrive — remounts rows so the staggered
   *  reveal replays for the new form (and never on ordinary re-renders). */
  revealKey?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
        {title}
      </p>
      <ul className="space-y-0.5 text-body">
        {items.map((i, index) => {
          const written = writtenValue?.(i.fieldId);
          return (
            <li
              key={`${revealKey ?? ""}|${i.fieldId}`}
              className="animate-slide-in-right"
              style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
            >
              <button
                type="button"
                title={reasonFor?.(i.fieldId)}
                data-written={written !== undefined || undefined}
                onClick={() => onJump?.(i.fieldId)}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-bg-base"
              >
                <StatusIcon status={i.status} written={written !== undefined} />
                <span className="flex-1 truncate text-text-primary">{i.label}</span>
                {(written ?? (i.status === "fillable" ? i.value : undefined)) !== undefined && (
                  <span className="truncate text-text-tertiary">
                    {written ?? (i.status === "fillable" ? i.value : "")}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
