import { Check, Minus, TriangleAlert, type LucideIcon } from "lucide-react";
import type { FillItem } from "@offeros/autofill";

// Status glyphs are lucide icons (canon) — not raw ✓/⚠/–.
// Ready = mint brand, needs-answer = amber, unrecognized = muted.
export const STATUS_ICON: Record<FillItem["status"], { Icon: LucideIcon; cls: string }> = {
  fillable: { Icon: Check, cls: "text-brand" },
  "needs-answer": { Icon: TriangleAlert, cls: "text-warning" },
  unknown: { Icon: Minus, cls: "text-text-tertiary" },
};

export function StatusIcon({ status, written }: { status: FillItem["status"]; written: boolean }) {
  // Written = the value verifiably landed on the page this session (or a
  // rehydrated report says it did) — a solid brand check, distinct from the
  // outline "ready" check. Rows flip to this live as the fill progresses.
  if (written) {
    return (
      <span
        aria-hidden
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-brand"
      >
        <Check className="h-2.5 w-2.5 text-brand-foreground" strokeWidth={3} />
      </span>
    );
  }
  const { Icon, cls } = STATUS_ICON[status];
  return <Icon aria-hidden className={`h-3.5 w-3.5 shrink-0 ${cls}`} />;
}
