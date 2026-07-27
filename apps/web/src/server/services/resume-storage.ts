import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Sanitize an arbitrary id for safe use as a filename component. Strips
 * everything but alphanumerics/-/_ so an untrusted id (import bundle JSON,
 * a client-supplied name) can't smuggle `../` and escape `storageDir`.
 */
export function sanitizeFilename(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function extensionForMimeType(mimeType: string): string {
  return mimeType === "application/pdf" ? ".pdf" : "";
}

/**
 * Write a resume file under `storageDir`, naming it from a sanitized `id`.
 * Creates `storageDir` if missing. Returns the path written.
 */
export function writeResumeFile(
  storageDir: string,
  id: string,
  mimeType: string,
  data: Buffer,
): string {
  mkdirSync(storageDir, { recursive: true, mode: 0o700 });
  // mkdirSync's `mode` only applies when the directory is newly created, so a
  // pre-existing dir (from before this tightening, or on a filesystem that
  // ignores mkdir modes) needs an explicit chmod too. Best-effort: exotic
  // filesystems degrade silently rather than block a résumé upload.
  try {
    chmodSync(storageDir, 0o700);
  } catch {
    // best-effort; unsupported on this filesystem/platform
  }
  const filePath = join(storageDir, `${sanitizeFilename(id)}${extensionForMimeType(mimeType)}`);
  writeFileSync(filePath, data);
  return filePath;
}
