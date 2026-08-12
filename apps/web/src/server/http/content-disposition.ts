/**
 * Build a `Content-Disposition` attachment header from a file name.
 *
 * Strips control characters (defense in depth — the Headers API already rejects
 * raw CRLF), escapes quotes for the ASCII fallback, and adds an RFC 5987 UTF-8
 * variant so non-ASCII names ("Résumé.pdf", a company written in Chinese)
 * survive intact instead of arriving as mojibake or as "download".
 *
 * Shared by every route that streams a file: the stored-résumé bytes and the
 * rendered artifact PDF now name their downloads the same way, which is the
 * point — a user who renames a document expects that name on disk.
 */
export function attachmentDisposition(name: string): string {
  const safe = Array.from(name)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join("");
  // A header value can only carry Latin-1. Anything above it — a document named
  // in Chinese, say — makes the whole header invalid, and the cost is not a
  // mangled filename but the loss of the entire Content-Disposition, attachment
  // and all. So characters outside Latin-1 are transliterated in the plain
  // `filename=` fallback while the real name travels in `filename*`, which
  // every browser released this decade prefers anyway. Accented Latin names
  // ("Jordan Résumé.pdf") are inside Latin-1 and pass through untouched.
  const latin1 = Array.from(safe)
    .map((ch) => ((ch.codePointAt(0) ?? 0) <= 0xff ? ch : "_"))
    .join("")
    .replace(/["\\]/g, "_");
  const fallback = latin1.replace(/_+/g, "_") === "_" ? "download" : latin1;
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
