import { mkdirSync, writeFileSync } from "node:fs";
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
  mkdirSync(storageDir, { recursive: true });
  const filePath = join(storageDir, `${sanitizeFilename(id)}${extensionForMimeType(mimeType)}`);
  writeFileSync(filePath, data);
  return filePath;
}
