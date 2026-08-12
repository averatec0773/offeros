import { cn } from "@/lib/utils";

/**
 * The mark on every button that spends the user's own API credit.
 *
 * OfferOS runs on a key the user brought and pays for themselves, and nothing
 * here calls a model unless they ask it to. That promise is only worth
 * something if it is visible at the moment of the click — so every button that
 * costs money carries the same glyph and the same tooltip, and every button
 * that does not carries neither.
 *
 * The absence is the other half of the design. Checking a posting, filling a
 * form, changing a status: no mark, because they cost nothing. One glance says
 * which of the things in front of you is the expensive one.
 */

export const SPEND_GLYPH = "✦";
export const SPEND_TITLE = "Calls your AI provider — uses your own API key";

/** The glyph on its own, for a control that is not a `SpendButton`. */
export function SpendMark({ className }: { className?: string }) {
  return (
    <span aria-hidden title={SPEND_TITLE} className={cn("select-none", className)}>
      {SPEND_GLYPH}
    </span>
  );
}

/**
 * A button that costs a model call. `label` is what it does; the glyph and the
 * title are supplied here so no call site has to remember them.
 */
export function SpendChip({
  onClick,
  label,
  busyLabel,
  busy = false,
  disabled = false,
  variant = "outline",
  className,
}: {
  onClick: () => void;
  label: string;
  /** Shown while `busy`. Defaults to the label, so it is never blank. */
  busyLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  variant?: "outline" | "primary" | "quiet";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={SPEND_TITLE}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-caption font-semibold transition-colors press disabled:opacity-50",
        variant === "primary" && "bg-primary text-primary-foreground hover:bg-primary/85",
        variant === "outline" && "border border-border text-foreground hover:bg-muted",
        variant === "quiet" && "text-muted-foreground hover:bg-muted",
        className,
      )}
    >
      <span aria-hidden className="select-none">
        {SPEND_GLYPH}
      </span>
      {busy ? (busyLabel ?? label) : label}
    </button>
  );
}
