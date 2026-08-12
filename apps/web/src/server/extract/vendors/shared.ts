/** Bits more than one adapter needs. Nothing here decides anything; it is the
 *  two ways a job id and a board name show up when a platform is embedded in
 *  someone else's page. */

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * A posting id out of the page's own URL — path segment or query value.
 *
 * Platforms that key postings by UUID put it in the link even when the page
 * around it belongs to the employer, which is what makes an embedded board
 * identifiable at all.
 */
export function uuidFromUrl(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    for (const value of url.searchParams.values()) {
      const match = UUID_ANYWHERE.exec(value);
      if (match) return match[0].toLowerCase();
    }
    const match = UUID_ANYWHERE.exec(url.pathname);
    return match ? match[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The first board name a page's markup gives up, trying each pattern in turn. */
export function boardFromHtml(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const found = pattern.exec(html)?.[1];
    if (found) return found.toLowerCase();
  }
  return null;
}
