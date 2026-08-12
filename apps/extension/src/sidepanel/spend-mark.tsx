/**
 * The mark on every button that spends the user's own API credit.
 *
 * The glyph and the wording are deliberately identical to the web app's
 * `components/agent/spend-chip.tsx`. The promise ("nothing calls a model unless
 * you ask it to") is only worth something if it looks the same in both places —
 * a user who learns the mark in the workspace must recognise it in the panel.
 *
 * The two are separate copies because the extension shares no UI package with
 * the web app; it replicates the design system the same way it replicates the
 * design tokens. If one changes, change both.
 */

export const SPEND_GLYPH = "✦";
export const SPEND_TITLE = "Calls your AI provider — uses your own API key";

export function SpendMark({ className }: { className?: string }) {
  return (
    <span aria-hidden title={SPEND_TITLE} className={`select-none ${className ?? ""}`}>
      {SPEND_GLYPH}
    </span>
  );
}
