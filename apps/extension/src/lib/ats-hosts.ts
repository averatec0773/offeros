/**
 * The one list of ATS hosts the extension runs on.
 *
 * There used to be three copies — the engine content script, the MAIN-world
 * combobox driver, and the manifest's host permissions — and they drifted. The
 * driver's copy was missing iCIMS, so on iCIMS the combobox driver never
 * injected and every react-select dropdown failed by 2500ms timeout, reported
 * as a plain failure with no hint that the cause was a missing script.
 *
 * A drift like that is invisible: each list looks complete on its own. So there
 * is one list, and everything derives from it.
 */
export const ATS_MATCHES = [
  "https://*.greenhouse.io/*",
  "https://boards.greenhouse.io/*",
  "https://job-boards.greenhouse.io/*",
  "https://jobs.lever.co/*",
  "https://jobs.eu.lever.co/*",
  "https://*.ashbyhq.com/*",
  "https://*.icims.com/*",
  "https://*.myworkdayjobs.com/*",
] as const;

/** Mutable copy — manifest fields and `defineContentScript` want `string[]`. */
export const atsMatches = (): string[] => [...ATS_MATCHES];
