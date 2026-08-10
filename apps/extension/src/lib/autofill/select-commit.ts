/**
 * Post-write verification for MAIN-world combobox drives (ats-driver).
 *
 * After a selection commits, react-select renders the choice into a
 * `*-single-value` node — but not necessarily as the option's menu label.
 * Greenhouse's new UI (job-boards.greenhouse.io) renders the country
 * dial-code select's chosen "United States +1" as just "+1", so verifying the
 * rendered text against the wanted value alone ("United States") reported a
 * committed selection as failed on every such form. The rendered text
 * therefore counts as committed when it matches EITHER the wanted value OR
 * the label of the option that was actually chosen.
 */

function textMatches(shown: string, want: string): boolean {
  const s = shown.trim().toLowerCase();
  const w = want.trim().toLowerCase();
  return s !== "" && w !== "" && (s.includes(w) || w.includes(s));
}

/**
 * strict=true (DOM fallback) requires seeing the single-value node;
 * strict=false (fiber path) tolerates non-react-select widgets that lack it.
 * `chosenLabel` is the label of the option the driver actually selected, when
 * it knows one — the render is accepted if it matches either string.
 */
export function verifyCommitted(
  input: HTMLElement,
  value: string,
  strict: boolean,
  chosenLabel?: string,
): boolean {
  const scope =
    input.closest('[class*="control"]')?.parentElement ??
    input.parentElement ??
    input.ownerDocument.body;
  const single = scope.querySelector('[class*="single-value"], [class*="singleValue"]');
  if (!single) return !strict;
  const shown = single.textContent ?? "";
  return (
    textMatches(shown, value) || (chosenLabel !== undefined && textMatches(shown, chosenLabel))
  );
}
